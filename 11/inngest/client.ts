import {Inngest} from 'inngest';
import type {StoredTicket} from '@/lib/store';
export const inngest=new Inngest({id:'s11-relay'});
export function sendTicket(ticket:StoredTicket){return inngest.send({id:ticket.run_token,name:'s11/ticket.received',data:{ticket_id:ticket.id,run_token:ticket.run_token}});}
