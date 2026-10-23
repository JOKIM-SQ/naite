import {createClient} from '@supabase/supabase-js';
import type {Ticket,TicketEvent,NewTicket,DemoMode} from './contracts';
export type StoredTicket=Ticket & {workspace_id:string;run_token:string};
export type TicketPatch=Partial<Pick<Ticket,'status'|'category'|'priority'|'confidence'|'needs_review'|'review_reason'|'reason'|'draft'|'error'|'attempts'>>;
export interface TicketStore{
 list(workspace:string):Promise<StoredTicket[]>;
 get(id:string,token:string):Promise<StoredTicket|null>;
 create(workspace:string,input:NewTicket):Promise<StoredTicket>;
 retry(id:string,workspace:string,mode:DemoMode):Promise<StoredTicket|null>;
 mutate(id:string,token:string,patch:TicketPatch,event?:TicketEvent):Promise<StoredTicket|null>;
}
export function eventFor(token:string,stage:string,attempt:number,message:string):TicketEvent{return {id:`${token}:${stage}:${attempt}`,stage,attempt,message,at:new Date().toISOString()};}
export function createStore():TicketStore{
 const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw new Error('문의 저장소 연결이 필요합니다.');
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(15000)})}});
 function check(error:unknown){if(error)throw new Error('문의 저장소 처리에 실패했습니다.');}
 return {
  async list(workspace){const {data,error}=await db.from('s11_tickets').select('*').eq('workspace_id',workspace).order('created_at',{ascending:false}).limit(200);check(error);return data as StoredTicket[];},
  async get(id,token){const {data,error}=await db.from('s11_tickets').select('*').eq('id',id).eq('run_token',token).maybeSingle();check(error);return data as StoredTicket|null;},
  async create(workspace,input){const token=crypto.randomUUID();const {data,error}=await db.from('s11_tickets').insert({...input,workspace_id:workspace,run_token:token,events:[eventFor(token,'queued',0,'문의가 접수되었습니다.')]}).select('*').single();check(error);return data as StoredTicket;},
  async retry(id,workspace,mode){const {data,error}=await db.rpc('s11_retry',{p_id:id,p_workspace:workspace,p_token:crypto.randomUUID(),p_demo:mode});check(error);return (data?.[0]??null) as StoredTicket|null;},
  async mutate(id,token,patch,event){const {data,error}=await db.rpc('s11_mutate',{p_id:id,p_token:token,p_patch:patch,p_event:event??null});check(error);return (data?.[0]??null) as StoredTicket|null;},
 };
}
