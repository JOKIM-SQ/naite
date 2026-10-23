import {z} from 'zod';
import {createHash} from 'node:crypto';
export const newTicketSchema=z.object({subject:z.string().trim().min(5).max(120),message:z.string().trim().min(10).max(5000),customer_name:z.string().trim().max(80).transform(v=>v||'고객'),channel:z.enum(['web','email','chat']),demo_mode:z.enum(['none','transient','permanent'])}).strict();
export const modelClassificationSchema=z.object({category:z.enum(['billing','account','technical','delivery','other']),priority:z.enum(['low','normal','high']),confidence:z.number().min(0).max(1),needs_review:z.boolean(),review_reason:z.string().max(1000).nullable(),reason:z.string().min(1).max(1000)}).strict();
export const classificationSchema=modelClassificationSchema.transform(v=>({...v,needs_review:v.needs_review||v.confidence<0.75,review_reason:v.needs_review||v.confidence<0.75?v.review_reason||'분류 근거가 충분하지 않아 담당자 확인이 필요합니다.':null}));
export const draftSchema=z.object({draft:z.string().trim().min(1).max(6000)}).strict();
export function publicTicket<T extends {workspace_id:string;run_token:string;events?:{id:string}[]}>(value:T){
 const {workspace_id,run_token,...result}=value;void workspace_id;void run_token;
 if(result.events)result.events=result.events.map(event=>({...event,id:createHash('sha256').update(event.id).digest('hex')}));
 return result;
}
export function requireSameOrigin(request:Request){
 const url=new URL(request.url);
 // Next may normalize a loopback request URL to localhost. Host retains the
 // actual browser authority. Forwarded host headers are deliberately ignored.
 const expectedOrigin=`${url.protocol}//${request.headers.get('host')||url.host}`;
 if(request.headers.get('origin')!==expectedOrigin||request.headers.get('sec-fetch-site')==='cross-site')throw new Error('허용되지 않은 요청입니다.');
}
