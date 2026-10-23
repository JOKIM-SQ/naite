import {classificationSchema,draftSchema} from './validation';
import {eventFor,type StoredTicket,type TicketStore} from './store';
type Generator=(ticket:StoredTicket)=>Promise<unknown>;
export async function finishTicket(id:string,token:string,store:TicketStore){
 const row=await store.get(id,token);if(!row)return {stale:true};
 if(!row.category||!row.draft)throw new Error('완료에 필요한 결과가 없습니다.');
 const saved=await store.mutate(id,token,{status:'completed',error:null},eventFor(token,'completed',row.attempts,'분류와 답변 초안 처리를 완료했습니다.'));
 return {completed:!!saved};
}
export async function failTicket(id:string,token:string,store:TicketStore){
 const row=await store.get(id,token);if(!row||row.status==='completed'||row.status==='failed')return;
 await store.mutate(id,token,{status:'failed',error:'자동 재시도를 모두 마쳤지만 처리하지 못했습니다. 다시 시도해 주세요.'},eventFor(token,'failed',row.attempts,'자동 재시도 종료 · 처리 실패'));
}
export async function classifyTicket(id:string,token:string,attempt:number,store:TicketStore,generate:Generator){
 const ticket=await store.get(id,token);
 if(!ticket||ticket.status==='completed'||ticket.status==='failed')return null;
 const count=attempt+1;
 if(!await store.mutate(id,token,{status:'classifying',attempts:count,error:null},eventFor(token,'classifying',count,'문의 내용을 분류하고 있습니다.')))return null;
 try{
  if(ticket.demo_mode==='permanent'||(ticket.demo_mode==='transient'&&attempt===0))throw new Error('demo');
  const classification=classificationSchema.parse(await generate(ticket));
  return await store.mutate(id,token,{...classification,status:'drafting'},eventFor(token,'classified',count,'분류를 완료했습니다.'))?classification:null;
 }catch{
  await store.mutate(id,token,{status:'retrying',error:'분류 처리에 실패했습니다. 재시도를 기다립니다.'},eventFor(token,'classification_retry',count,'분류 처리 실패 · 자동 재시도 대기'));
  throw new Error('문의 분류를 완료하지 못했습니다.');
 }
}
export async function draftTicket(id:string,token:string,attempt:number,store:TicketStore,generate:Generator){
 const ticket=await store.get(id,token);
 if(!ticket||ticket.status==='completed'||ticket.status==='failed')return null;
 const count=attempt+1;
 if(!await store.mutate(id,token,{status:'drafting',error:null,attempts:Math.max(ticket.attempts,count)},eventFor(token,'drafting',count,'답변 초안을 작성하고 있습니다.')))return null;
 try{
  const result=draftSchema.parse(await generate(ticket));
  return await store.mutate(id,token,{draft:result.draft},eventFor(token,'drafted',count,'답변 초안을 작성했습니다.'))?result:null;
 }catch{
  await store.mutate(id,token,{status:'retrying',error:'초안 생성에 실패했습니다. 재시도를 기다립니다.'},eventFor(token,'draft_retry',count,'초안 작성 실패 · 자동 재시도 대기'));
  throw new Error('답변 초안을 작성하지 못했습니다.');
 }
}
