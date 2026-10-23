import {eventFor,type StoredTicket,type TicketStore} from './store';
export async function enqueueTicket(ticket:StoredTicket,store:TicketStore,send:(ticket:StoredTicket)=>Promise<unknown>){
 try{await send(ticket);return ticket;}
 catch{
  await store.mutate(ticket.id,ticket.run_token,{status:'failed',error:'작업 큐 접수에 실패했습니다. 다시 시도해 주세요.'},eventFor(ticket.run_token,'failed',0,'작업 큐 접수 실패'));
  throw new Error('문의 접수를 완료하지 못했습니다.');
 }
}
