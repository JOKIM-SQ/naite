import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
export const user = '11111111-1111-4111-8111-111111111111';
export const other = '22222222-2222-4222-8222-222222222222';
export const id = '33333333-3333-4333-8333-333333333333';
export function row(overrides = {}) {
  const prefix = `${user}/${id}/44444444-4444-4444-8444-444444444444`;
  return { id, user_id:user, name:'카드', created_at:1700000000000, palette:['#112233','#223344','#334455','#445566','#556677'],width:640,height:480,columns:96,grid_width:96,grid_height:72,pixel_mode:'detail',source_path:`${prefix}/source`,thumbnail_path:`${prefix}/thumbnail`,pixel_path:`${prefix}/pixel`,...overrides };
}
export async function database() {
 const db = new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid primary key); INSERT INTO auth.users VALUES ('${user}'),('${other}'); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; GRANT USAGE ON SCHEMA auth TO authenticated,anon; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon; CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated,anon; GRANT SELECT,INSERT,DELETE ON storage.objects TO authenticated,anon;`);
 await db.exec(await readFile(new URL('../../SUPABASE.sql',import.meta.url),'utf8'));
 return db;
}
export async function asUser(db, who=user, role='authenticated') { await db.exec(`RESET ROLE; SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub','${who}',false);`); }
