import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { database,asUser,row,user,other,id } from './support/cloud-db.mjs';
import { createCloudStore } from '../public/cloud-store.mjs';

// External HTTP transport only is replaced: SDK request encoding, store, SQL/RLS run for real.
async function fixture() {
 const db=await database();await asUser(db);
 const files=new Map();const state={session:user,failUpload:false,failSave:false,failCleanup:false,failDownload:false,uploads:0,onUpload:null,failAfterSave:false,failAfterDelete:false,malformedRow:false};
 const client=createClient('https://test.supabase.co','test-public-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,init={})=>{
 const url=new URL(String(input));const method=init.method??'GET';
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
 try{
 if(url.pathname.startsWith('/rest/v1/rpc/')){
 if(state.failSave&&url.pathname.endsWith('s09_save_card'))return json(state.saveError??{message:'save failed',code:'23514'},400);
 const body=JSON.parse(init.body);const fn=url.pathname.split('/').at(-1);
 const committed=await db.query(fn==='s09_save_card'?'SELECT s09_save_card($1::jsonb,$2::bigint)':'SELECT s09_delete_card($1::uuid)',fn==='s09_save_card'?[body.p_card,body.p_expected_revision??null]:[body.p_id]);if(state.failAfterDelete && fn==='s09_delete_card') return json({message:'connection lost after delete'},500);if(state.failAfterSave && fn==='s09_save_card') return json({message:'connection lost after commit'},500);return json(committed.rows[0][fn]);
 }
 if(url.pathname.startsWith('/rest/v1/')){
 const table=url.pathname.split('/').at(-1);
 if(method==='DELETE'){await db.query(`DELETE FROM ${table} WHERE id=$1`,[url.searchParams.get('id').slice(3)]);return new Response(null,{status:204});}
 const rows=(await db.query(`SELECT * FROM ${table} ORDER BY created_at DESC`)).rows.filter(row=>!url.searchParams.has('id')||row.id===url.searchParams.get('id').slice(3));
 if(state.malformedRow && table==='s09_cards') rows[0].source_path='someone/else/source';
 return json(rows);
 }
 if(url.pathname.startsWith('/storage/v1/object/')){
 const prefix='/storage/v1/object/';const tail=decodeURIComponent(url.pathname.slice(prefix.length));
 if(method==='DELETE'){
 if(state.failCleanup)return json({message:'cleanup failed'},500);
 for(const path of JSON.parse(init.body).prefixes)files.delete(path);return json([]);
 }
 const path=tail.replace(/^authenticated\//,'').replace(/^s09-chroma-images\//,'');
 if(method==='POST'){
 if(state.failUpload)return json({message:'upload failed'},500);
 assert.equal(new Headers(init.headers).get('x-upsert'),'false');
 const blob=init.body instanceof FormData?init.body.get(''):init.body;
 files.set(path,blob);state.uploads++;await state.onUpload?.();return json({Key:`s09-chroma-images/${path}`});
 }
 if(state.failDownload||!files.has(path))return json({message:'missing image'},404);
 return new Response(files.get(path),{headers:{'content-type':'image/png'}});
 }
 throw new Error('Unexpected transport '+url);
 }catch(error){return json({message:error.message,code:error.code,details:error.detail},400);}
 }}});
 client.auth.getSession=async()=>({data:{session:state.session?{user:{id:state.session}}:null},error:null});
 const store=await createCloudStore(client,user);
 const record={id,name:'풍경',createdAt:1700000000000,palette:row().palette,width:640,height:480,columns:96,gridWidth:96,gridHeight:72,pixelMode:'detail',sourceBlob:new Blob(['original'],{type:'image/png'}),thumbnailBlob:new Blob(['thumb'],{type:'image/png'}),pixelBlob:new Blob(['pixel'],{type:'image/png'})};
 return {db,files,state,client,store,record,async close(){store.close();await db.close();}};
}
test('save reload rename and replacement persist blobs without reuploading unchanged images',async()=>{
 const f=await fixture();try{await f.store.put(f.record);assert.equal(f.files.size,3);
 const [loaded]=await f.store.list();assert.equal(await loaded.sourceBlob.text(),'original');assert.equal(loaded.pixelMode,'detail');
 await f.store.put({...loaded,name:'새 이름'});assert.equal(f.state.uploads,3);
 await f.store.put({...loaded,name:'새 이름',pixelBlob:new Blob(['replacement'],{type:'image/png'})});
 assert.equal(f.state.uploads,4);assert.equal(f.files.size,3);
 const [again]=await f.store.list();assert.equal(again.name,'새 이름');assert.equal(await again.pixelBlob.text(),'replacement');
 assert.equal((await f.db.query('SELECT * FROM s09_image_cleanup')).rows.length,0);
 }finally{await f.close();}
});
test('failed database commit rolls back uploaded files and never reports saved row',async()=>{
 const f=await fixture();try{f.state.failSave=true;await assert.rejects(f.store.put(f.record),/저장/);assert.equal(f.files.size,0);assert.equal((await f.db.query('SELECT * FROM s09_cards')).rows.length,0);
 }finally{await f.close();}
});
test('cleanup failure keeps successful deletion durable and list retries orphan cleanup',async()=>{
 const f=await fixture();try{await f.store.put(f.record);f.state.failCleanup=true;await f.store.remove(id);
 assert.equal((await f.db.query('SELECT * FROM s09_cards')).rows.length,0);assert.equal(f.files.size,3);assert.equal((await f.db.query('SELECT * FROM s09_image_cleanup')).rows.length,1);
 f.state.failCleanup=false;assert.deepEqual(await f.store.list(),[]);assert.equal(f.files.size,0);assert.equal((await f.db.query('SELECT * FROM s09_image_cleanup')).rows.length,0);
 }finally{await f.close();}
});
test('replacement cleanup failure preserves successful save; partial download is explicit failure',async()=>{
 const f=await fixture();try{await f.store.put(f.record);f.state.failCleanup=true;await f.store.put({...f.record,pixelBlob:new Blob(['new'],{type:'image/png'})});assert.equal(f.files.size,4);
 assert.equal(await (await f.store.list())[0].pixelBlob.text(),'new');f.state.failDownload=true;await assert.rejects(f.store.list(),/이미지/);
 }finally{await f.close();}
});
test('account switch during upload prevents metadata commit; logged out and closed stores reject',async()=>{
 const f=await fixture();try{f.state.onUpload=()=>{f.state.session=other;};await assert.rejects(f.store.put(f.record),/계정|로그인/);assert.equal((await f.db.query('SELECT * FROM s09_cards')).rows.length,0);
 f.state.session=null;await assert.rejects(f.store.list(),/계정|로그인/);await assert.rejects(f.store.remove(id),/계정|로그인/);
 f.state.session=user;f.store.close();await assert.rejects(f.store.list(),/닫/);
 }finally{await f.close();}
});
test('invalid row paths are rejected before download; unsupported upload never writes metadata',async()=>{
 const f=await fixture();try{await assert.rejects(f.store.put({...f.record,palette:['#000000']}),/카드|색/);await assert.rejects(f.store.put({...f.record,sourceBlob:new Blob(['x'],{type:'text/plain'})}),/이미지/);assert.equal(f.files.size,0);
 }finally{await f.close();}
});

test('lost commit response reconciles saved metadata without deleting committed images',async()=>{
 const f=await fixture();try{f.state.failAfterSave=true;await f.store.put(f.record);assert.equal(f.files.size,3);const [saved]=await f.store.list();assert.equal(saved.name,'풍경');assert.equal(await saved.pixelBlob.text(),'pixel');}finally{await f.close();}
});
test('partial upload rolls back the first image and malformed downloaded metadata is rejected',async()=>{
 const f=await fixture();try{f.state.onUpload=()=>{f.state.failUpload=true;};await assert.rejects(f.store.put(f.record),/업로드/);assert.equal(f.files.size,0);assert.equal((await f.db.query('SELECT * FROM s09_cards')).rows.length,0);
 f.state.onUpload=null;f.state.failUpload=false;await f.store.put(f.record);f.state.malformedRow=true;await assert.rejects(f.store.list(),/경로/);
 }finally{await f.close();}
});

test('lost delete response confirms absent metadata and completes cleanup successfully',async()=>{
 const f=await fixture();try{await f.store.put(f.record);f.state.failAfterDelete=true;await f.store.remove(id);assert.deepEqual(await f.store.list(),[]);assert.equal(f.files.size,0);assert.equal((await f.db.query('SELECT * FROM s09_image_cleanup')).rows.length,0);}finally{await f.close();}
});

test('stale tab rename cannot resurrect cleaned paths or delete another tab replacement',async()=>{
 const f=await fixture();const second=await createCloudStore(f.client,user);try{
 await f.store.put(f.record);const [old]=await f.store.list();const [fresh]=await second.list();
 await second.put({...fresh,pixelBlob:new Blob(['other tab'],{type:'image/png'})});
 await assert.rejects(f.store.put({...old,name:'stale rename'}),/다시|변경/);
 assert.equal(await (await second.list())[0].pixelBlob.text(),'other tab');assert.equal(f.files.size,3);
 await second.remove(id);await assert.rejects(f.store.put({...old,name:'resurrect'}),/다시|변경/);assert.deepEqual(await second.list(),[]);
 }finally{second.close();await f.close();}
});

test('a concurrent fresh import cannot overwrite an existing card and rolls back its new files',async()=>{
 const f=await fixture();const second=await createCloudStore(f.client,user);try{await f.store.put(f.record);await assert.rejects(second.put({...f.record,name:'duplicate import'}),/다른 탭/);assert.equal((await f.store.list())[0].name,'풍경');assert.equal(f.files.size,3);}finally{second.close();await f.close();}
});

test('a P0001 error without the revision sentinel is not misreported as a stale-tab conflict',async()=>{
 const f=await fixture();try{f.state.failSave=true;f.state.saveError={message:'owner mismatch',code:'P0001',details:null};
 await assert.rejects(f.store.put(f.record),error=>/저장/.test(error.message)&&!/다른 탭/.test(error.message));
 assert.equal(f.files.size,0);assert.equal((await f.db.query('SELECT * FROM s09_cards')).rows.length,0);
 }finally{await f.close();}
});
