import {NextResponse,type NextRequest} from 'next/server';
import {z} from 'zod';
export function workspaceFor(request:NextRequest){const value=request.cookies.get('s11_workspace')?.value;return z.uuid().safeParse(value).success?value!:crypto.randomUUID();}
export function jsonResponse(body:unknown,status:number,request:NextRequest,workspace:string){
 const response=NextResponse.json(body,{status,headers:{'Cache-Control':'no-store, private','Vary':'Cookie'}});
 response.cookies.set('s11_workspace',workspace,{httpOnly:true,sameSite:'lax',secure:new URL(request.url).protocol==='https:',path:'/',maxAge:31536000});return response;
}
export async function requestBody(request:Request){
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error('JSON only');
 const body=await request.text();if(body.length>24000)throw new Error('Body too large');return JSON.parse(body) as unknown;
}
