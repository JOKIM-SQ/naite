import {z} from 'zod';
import {inngest} from './client';
import {createStore} from '@/lib/store';
import {classifyTicket,draftTicket,finishTicket,failTicket} from '@/lib/processing';
import {classifyWithAI,draftWithAI} from '@/lib/ai';
const eventData=z.object({ticket_id:z.uuid(),run_token:z.uuid()});
export const triageTicket=inngest.createFunction({
 id:'triage-ticket',triggers:[{event:'s11/ticket.received'}],retries:2,
 concurrency:[{limit:4},{limit:1,key:'event.data.ticket_id'}],
 onFailure:async({event})=>{
  const parsed=eventData.safeParse(event.data.event.data);if(!parsed.success)return;
  const {ticket_id:id,run_token:token}=parsed.data;await failTicket(id,token,createStore());
 },
},async({event,step,attempt})=>{
 const {ticket_id:id,run_token:token}=eventData.parse(event.data);
 const classification=await step.run('classify',()=>classifyTicket(id,token,attempt,createStore(),classifyWithAI));
 if(!classification)return {stale:true};
 const draft=await step.run('draft',()=>draftTicket(id,token,attempt,createStore(),draftWithAI));
 if(!draft)return {stale:true};
 return await step.run('complete',()=>finishTicket(id,token,createStore()));
});
