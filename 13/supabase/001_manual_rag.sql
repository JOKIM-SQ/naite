-- S13 only. Safe to rerun in the Supabase SQL editor after a partial application.
-- Quote "position" consistently: it is also PostgreSQL syntax for a string function.
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create table if not exists public.s13_documents (
 id uuid primary key,
 session_hash text not null check(length(session_hash)=64),
 name text not null check(length(name)<=120),
 content text not null check(length(content)<=40000),
 chunk_count integer not null,
 created_at timestamptz not null default now()
);
create table if not exists public.s13_chunks (
 id bigint generated always as identity primary key,
 document_id uuid not null references public.s13_documents(id) on delete cascade,
 "position" integer not null,
 section text not null,
 content text not null,
 embedding extensions.vector(512) not null,
 unique(document_id,"position")
);
create index if not exists s13_documents_session_idx on public.s13_documents(session_hash);
create index if not exists s13_chunks_document_idx on public.s13_chunks(document_id);
alter table public.s13_documents enable row level security;
alter table public.s13_chunks enable row level security;
revoke all on public.s13_documents, public.s13_chunks from anon, authenticated;
grant all on public.s13_documents, public.s13_chunks to service_role;
grant usage, select on sequence public.s13_chunks_id_seq to service_role;

create or replace function public.s13_ingest_document(p_session_hash text,p_id uuid,p_name text,p_content text,p_chunks jsonb)
returns table(id uuid,name text,chunk_count integer,created_at timestamptz)
language plpgsql set search_path=public,extensions as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_session_hash,13));
 if (select count(*) from public.s13_documents d where d.session_hash=p_session_hash)>=10 then
   raise exception 'S13_DOCUMENT_LIMIT';
 end if;
 insert into public.s13_documents(id,session_hash,name,content,chunk_count)
 values(p_id,p_session_hash,p_name,p_content,jsonb_array_length(p_chunks));
 insert into public.s13_chunks(document_id,"position",section,content,embedding)
 select p_id,(c->>'position')::integer,c->>'section',c->>'content',(c->>'embedding')::extensions.vector(512)
 from jsonb_array_elements(p_chunks) c;
 return query select d.id,d.name,d.chunk_count,d.created_at from public.s13_documents d where d.id=p_id;
end;
$$;
create or replace function public.s13_match_chunks(p_session_hash text,p_document_id uuid,p_embedding extensions.vector(512),p_threshold double precision default 0.35,p_count integer default 4)
returns table(content text,section text,"position" integer,similarity double precision)
language sql stable set search_path=public,extensions as $$
 select c.content,c.section,c."position",1-(c.embedding <=> p_embedding) as similarity
 from public.s13_chunks c join public.s13_documents d on d.id=c.document_id
 where d.id=p_document_id and d.session_hash=p_session_hash and 1-(c.embedding <=> p_embedding)>=p_threshold
 order by c.embedding <=> p_embedding limit least(greatest(p_count,1),4);
$$;
revoke all on function public.s13_ingest_document(text,uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.s13_match_chunks(text,uuid,extensions.vector,double precision,integer) from public,anon,authenticated;
grant execute on function public.s13_ingest_document(text,uuid,text,text,jsonb) to service_role;
grant execute on function public.s13_match_chunks(text,uuid,extensions.vector,double precision,integer) to service_role;
notify pgrst, 'reload schema';
