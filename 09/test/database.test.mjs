import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { database,asUser,row,user,other,id } from './support/cloud-db.mjs';
// Removing owner RLS or transactional cleanup must fail these persisted-state assertions.
test('schema is rerunnable; owner save/delete atomically queues images and preserves other cards', async () => {
 const db=await database(); try {
 await db.exec(await readFile(new URL('../SUPABASE.sql',import.meta.url),'utf8'));
 await asUser(db);
 await db.query('SELECT public.s09_save_card($1::jsonb)',[row()]);
 const second='55555555-5555-4555-8555-555555555555';
 await db.query('SELECT public.s09_save_card($1::jsonb)',[row({id:second,source_path:row().source_path.replace(id,second),thumbnail_path:row().thumbnail_path.replace(id,second),pixel_path:row().pixel_path.replace(id,second)})]);
 await db.query('SELECT public.s09_delete_card($1::uuid)',[id]);
 assert.deepEqual((await db.query('SELECT id FROM s09_cards')).rows,[{id:second}]);
 assert.deepEqual((await db.query('SELECT paths FROM s09_image_cleanup')).rows[0].paths,[row().source_path,row().thumbnail_path,row().pixel_path]);
 } finally {await db.close();}
});
test('cross-account and anonymous requests cannot read mutate or delete owner data',async()=>{
 const db=await database();try {
 await asUser(db);await db.query('SELECT s09_save_card($1::jsonb)',[row()]);
 await db.query('INSERT INTO storage.objects(bucket_id,name) VALUES ($1,$2)',['s09-chroma-images',row().source_path]);
 await asUser(db,other);
 assert.equal((await db.query('SELECT * FROM s09_cards')).rows.length,0);
 assert.equal((await db.query('SELECT * FROM storage.objects')).rows.length,0);
 await assert.rejects(db.query('SELECT s09_save_card($1::jsonb)',[row()]));
 await db.query('SELECT s09_delete_card($1::uuid)',[id]);
 await assert.rejects(db.query('INSERT INTO storage.objects(bucket_id,name) VALUES ($1,$2)',['s09-chroma-images',row().source_path]));
 await asUser(db,'','anon');
 for(const sql of ['SELECT * FROM s09_cards','SELECT * FROM s09_image_cleanup',`SELECT s09_delete_card('${id}')`,`SELECT s09_save_card('{}')`]) await assert.rejects(db.query(sql));
 await asUser(db);assert.equal((await db.query('SELECT * FROM s09_cards')).rows.length,1);
 }finally{await db.close();}
});
test('invalid palettes dimensions and paths cannot persist; replacing images queues only old paths',async()=>{
 const db=await database();try{await asUser(db);
 for(const invalid of [{palette:['#fff']},{palette:['bad','#223344','#334455','#445566','#556677']},{width:0},{grid_height:0},{columns:33},{pixel_mode:'bad'},{source_path:`${other}/${id}/x/source`},{source_path:`${user}/${id}/../source`}]) await assert.rejects(db.query('SELECT s09_save_card($1::jsonb)',[row(invalid)]));
 assert.equal((await db.query('SELECT * FROM s09_cards')).rows.length,0);
 await db.query('SELECT s09_save_card($1::jsonb)',[row()]);
 await db.query('SELECT s09_save_card($1::jsonb,1)',[row({name:'새 제목'})]);
 assert.equal((await db.query('SELECT * FROM s09_image_cleanup')).rows.length,0);
 await db.query('SELECT s09_save_card($1::jsonb,2)',[row({pixel_path:row().pixel_path.replace('44444444','66666666')})]);
 assert.deepEqual((await db.query('SELECT paths FROM s09_image_cleanup')).rows[0].paths,[row().pixel_path]);
 }finally{await db.close();}
});

test('delete and queue insertion roll back together when durable cleanup cannot be recorded',async()=>{
 const db=await database();try{
 await asUser(db);await db.query('SELECT s09_save_card($1::jsonb)',[row()]);
 await db.exec(`RESET ROLE; CREATE FUNCTION public.reject_cleanup_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'queue unavailable'; END $$; CREATE TRIGGER reject_cleanup_test BEFORE INSERT ON s09_image_cleanup FOR EACH ROW EXECUTE FUNCTION public.reject_cleanup_test();`);
 await asUser(db);await assert.rejects(db.query('SELECT s09_delete_card($1::uuid)',[id]),/queue unavailable/);
 assert.deepEqual((await db.query('SELECT id FROM s09_cards')).rows,[{id}]);
 assert.equal((await db.query('SELECT * FROM s09_image_cleanup')).rows.length,0);
 }finally{await db.close();}
});

test('storage rejects malformed card/version UUID paths even under the current user prefix',async()=>{
 const db=await database();try{await asUser(db);
 for(const path of [`${user}/${'-'.repeat(36)}/44444444-4444-4444-8444-444444444444/source`,`${user}/${id}/${'-'.repeat(36)}/pixel`,`${user}/${id}/44444444-4444-4444-8444-444444444444/../source`])
 await assert.rejects(db.query('INSERT INTO storage.objects(bucket_id,name) VALUES ($1,$2)',['s09-chroma-images',path]));
 assert.equal((await db.query('SELECT * FROM storage.objects')).rows.length,0);
 }finally{await db.close();}
});

test('save and delete take transaction advisory locks even for previously absent cards',async()=>{
 const db=await database();try{await asUser(db);
 for(const [sql,arg] of [['SELECT s09_save_card($1::jsonb)',row()],['SELECT s09_delete_card($1::uuid)',id]]){
 await db.exec('BEGIN');await db.query(sql,[arg]);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND granted")).rows[0].n,1);
 await db.exec('COMMIT');assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND granted")).rows[0].n,0);
 }
 }finally{await db.close();}
});

test('revision conflicts expose a non-serialization SQLSTATE with an explicit detail sentinel',async()=>{
 const db=await database();try{await asUser(db);await db.query('SELECT s09_save_card($1::jsonb)',[row()]);
 await assert.rejects(db.query('SELECT s09_save_card($1::jsonb)',[row()]),error=>error.code==='P0001'&&error.detail==='s09_revision_conflict');
 assert.equal((await db.query('SELECT revision FROM s09_cards')).rows[0].revision,1);
 }finally{await db.close();}
});
