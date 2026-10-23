import type {NextRequest} from 'next/server';
import {createStore} from '@/lib/store';
import {newTicketSchema,publicTicket,requireSameOrigin} from '@/lib/validation';
import {workspaceFor,jsonResponse,requestBody} from '@/lib/http';
import {enqueueTicket} from '@/lib/service';
import {sendTicket} from '@/inngest/client';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
 const workspace=workspaceFor(request);
 try{return jsonResponse({tickets:(await createStore().list(workspace)).map(publicTicket)},200,request,workspace);}
 catch{return jsonResponse({error:'문의 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'},503,request,workspace);}
}
export async function POST(request:NextRequest){
 const workspace=workspaceFor(request);let input;
 try{requireSameOrigin(request);input=newTicketSchema.parse(await requestBody(request));}
 catch{return jsonResponse({error:'문의 제목과 내용을 확인해 주세요. 같은 사이트에서 접수할 수 있습니다.'},400,request,workspace);}
 try{const store=createStore();const ticket=await store.create(workspace,input);await enqueueTicket(ticket,store,sendTicket);return jsonResponse({ticket:publicTicket(ticket)},202,request,workspace);}
 catch{return jsonResponse({error:'문의 접수를 완료하지 못했습니다. 목록을 확인한 뒤 다시 시도해 주세요.'},503,request,workspace);}
}
