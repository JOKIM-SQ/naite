import type {NextRequest} from 'next/server';
import {z} from 'zod';
import {createStore} from '@/lib/store';
import {publicTicket,requireSameOrigin} from '@/lib/validation';
import {workspaceFor,jsonResponse,requestBody} from '@/lib/http';
import {enqueueTicket} from '@/lib/service';
import {sendTicket} from '@/inngest/client';
export const runtime='nodejs';
export async function POST(request:NextRequest,context:{params:Promise<{id:string}>}){
 const workspace=workspaceFor(request);let id:string;let mode:'none'|'transient'|'permanent';
 try{requireSameOrigin(request);id=z.uuid().parse((await context.params).id);mode=z.object({demo_mode:z.enum(['none','transient','permanent']).default('none')}).strict().parse(await requestBody(request)).demo_mode;}
 catch{return jsonResponse({error:'재시도 요청을 확인해 주세요.'},400,request,workspace);}
 try{const store=createStore();const ticket=await store.retry(id,workspace,mode);if(!ticket)return jsonResponse({error:'재시도할 수 있는 실패 문의가 없습니다.'},409,request,workspace);await enqueueTicket(ticket,store,sendTicket);return jsonResponse({ticket:publicTicket(ticket)},202,request,workspace);}
 catch{return jsonResponse({error:'재시도 접수에 실패했습니다. 잠시 후 다시 시도해 주세요.'},503,request,workspace);}
}
