import { expect, it } from 'vitest';
import { enqueueTicket } from '../lib/service';
import type { StoredTicket, TicketStore } from '../lib/store';

const ticket = {id:'ticket',run_token:'run',workspace_id:'workspace',status:'queued'} as StoredTicket;
function boundary() {
  const changes: unknown[] = [];
  const store = {create:async()=>ticket, mutate:async(...args:unknown[])=>{changes.push(args);return ticket;}} as unknown as TicketStore;
  return {store,changes};
}
it('returns accepted ticket after queue acknowledgment without executing AI', async()=>{
  const {store}=boundary();
  let ack: (()=>void)|undefined;
  let finished=false;
  const result=enqueueTicket(ticket,store,async()=>new Promise<void>(resolve=>{ack=resolve;})).then(value=>{finished=true;return value;});
  await Promise.resolve();
  expect(finished).toBe(false);
  ack?.();
  expect((await result).status).toBe('queued');
});
it('records enqueue failure and rejects rather than claiming acceptance',async()=>{
  const {store,changes}=boundary();
  await expect(enqueueTicket(ticket,store,async()=>{throw new Error('secret provider detail');})).rejects.toThrow('접수');
  expect(JSON.stringify(changes)).toContain('failed');
  expect(JSON.stringify(changes)).not.toContain('secret provider detail');
});
