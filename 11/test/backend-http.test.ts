import {beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const db=vi.hoisted(()=>({list:vi.fn(),create:vi.fn(),retry:vi.fn(),mutate:vi.fn()}));
vi.mock('../lib/store',async original=>({...await original<object>(),createStore:()=>db}));
vi.mock('../inngest/client',()=>({sendTicket:async()=>({ids:['event']})}));
import {GET,POST} from '../app/api/tickets/route';
import {POST as retry} from '../app/api/tickets/[id]/retry/route';
const workspace='11111111-1111-4111-8111-111111111111';
const id='22222222-2222-4222-8222-222222222222';
beforeEach(()=>{vi.clearAllMocks();db.list.mockResolvedValue([]);});
function request(path:string,body?:unknown,origin='http://localhost:3110'){
 return new NextRequest(`http://localhost:3110${path}`,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json',cookie:`s11_workspace=${workspace}`},...(body?{body:JSON.stringify(body)}:{})});
}
it('GET scopes database query by HttpOnly workspace and strips server secrets',async()=>{
 db.list.mockResolvedValue([{id,workspace_id:workspace,run_token:'private'}]);
 const response=await GET(request('/api/tickets'));
 expect(response.status).toBe(200);expect(await response.json()).toEqual({tickets:[{id}]});
 expect(db.list).toHaveBeenCalledWith(workspace);expect(response.headers.get('cache-control')).toContain('no-store');
 expect(response.headers.get('set-cookie')).toContain('HttpOnly');
});
it('cross origin POST never stores a ticket',async()=>{
 const response=await POST(request('/api/tickets',{subject:'문의합니다',message:'문의 내용이 들어갑니다',customer_name:'고객',channel:'web',demo_mode:'none'},'https://evil.test'));
 expect(response.status).toBe(400);expect(db.create).not.toHaveBeenCalled();
});
it('foreign or non-failed retry cannot enqueue or reveal a ticket',async()=>{
 db.retry.mockResolvedValue(null);
 const response=await retry(request(`/api/tickets/${id}/retry`,{demo_mode:'none'}),{params:Promise.resolve({id})});
 expect(response.status).toBe(409);expect(db.retry).toHaveBeenCalledWith(id,workspace,'none');
});
