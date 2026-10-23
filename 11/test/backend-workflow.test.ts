import {describe,expect,it} from 'vitest';
import {classifyTicket,draftTicket,finishTicket,failTicket} from '../lib/processing';
import type {StoredTicket,TicketStore} from '../lib/store';

// External storage boundary only; stage transitions, validation and demo logic are real.
function fixture(mode:'none'|'transient'|'permanent'='none'){
 let row={id:'one',run_token:'run',workspace_id:'space',subject:'환불 문의입니다',message:'중복 결제가 발생했어요. 확인해 주세요.',demo_mode:mode,status:'queued',attempts:0,events:[]} as unknown as StoredTicket;
 let stale=false;
 const store={
  get:async()=>stale?null:row,
  mutate:async(_id:string,token:string,patch:Partial<StoredTicket>,event:StoredTicket['events'][number])=>{
   if(stale || token!==row.run_token)return null;
   row={...row,...patch,events:[...row.events,event]};return row;
  },
 } as unknown as TicketStore;
 return {store,row:()=>row,invalidate:()=>{stale=true;}};
}
const valid={category:'billing',priority:'normal',confidence:0.4,needs_review:false,review_reason:null,reason:'주문정보 확인 필요'};
describe('durable stage boundaries',()=>{
 it('keeps uncertain successful classification distinct from system failure',async()=>{
  const f=fixture();await classifyTicket('one','run',0,f.store,async()=>valid);
  expect(f.row().needs_review).toBe(true);expect(f.row().status).toBe('drafting');
 });
 it('throws a transient first failure then allows the real next attempt',async()=>{
  const f=fixture('transient');
  await expect(classifyTicket('one','run',0,f.store,async()=>valid)).rejects.toThrow();
  expect(f.row().status).toBe('retrying');
  await classifyTicket('one','run',1,f.store,async()=>valid);
  expect(f.row().attempts).toBe(2);expect(f.row().status).toBe('drafting');
 });
 it('throws on every permanent failure attempt',async()=>{
  const f=fixture('permanent');
  for(let i=0;i<3;i++)await expect(classifyTicket('one','run',i,f.store,async()=>valid)).rejects.toThrow();
  expect(f.row().attempts).toBe(3);expect(f.row().status).toBe('retrying');
 });
 it('stale execution never calls AI or mutates current run',async()=>{
  const f=fixture();f.invalidate();let calls=0;
  expect(await classifyTicket('one','old',0,f.store,async()=>{calls++;return valid;})).toBeNull();
  expect(calls).toBe(0);expect(f.row().status).toBe('queued');
 });
 it('invalid external classification is rejected and recorded as retrying',async()=>{
  const f=fixture();await expect(classifyTicket('one','run',0,f.store,async()=>({...valid,confidence:200}))).rejects.toThrow();
  expect(f.row().status).toBe('retrying');expect(f.row().category).toBeUndefined();
 });
 it('draft persists validated response but cannot complete an invalid response',async()=>{
  const f=fixture();await expect(draftTicket('one','run',0,f.store,async()=>({draft:''}))).rejects.toThrow();
  expect(f.row().draft).toBeUndefined();
  await draftTicket('one','run',1,f.store,async()=>({draft:'주문번호를 알려주시면 결제 내역을 확인하겠습니다.'}));
  expect(f.row().draft).toContain('주문번호');expect(f.row().status).not.toBe('completed');
 });
 it('completion requires persisted classification and draft',async()=>{
  const f=fixture();await expect(finishTicket('one','run',f.store)).rejects.toThrow();
  await classifyTicket('one','run',0,f.store,async()=>valid);
  await draftTicket('one','run',0,f.store,async()=>({draft:'확인을 위해 주문번호를 알려주세요.'}));
  await finishTicket('one','run',f.store);
  expect(f.row().status).toBe('completed');expect(f.row().needs_review).toBe(true);
 });
 it('failure finalizer records terminal failure but ignores stale runs',async()=>{
  const f=fixture();await failTicket('one','run',f.store);
  expect(f.row().status).toBe('failed');
  const other=fixture();other.invalidate();await failTicket('one','old',other.store);
  expect(other.row().status).toBe('queued');
 });
});
