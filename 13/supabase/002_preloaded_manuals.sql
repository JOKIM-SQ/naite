-- S13 additive migration. Existing private documents and their chunks are preserved.
alter table public.s13_documents add column if not exists is_preloaded boolean not null default false;
alter table public.s13_documents add column if not exists status text not null default 'ready';
alter table public.s13_documents add column if not exists indexed_chunks integer not null default 0;
alter table public.s13_documents add column if not exists source jsonb not null default '{}'::jsonb;
alter table public.s13_documents drop constraint if exists s13_documents_content_check;
alter table public.s13_documents add constraint s13_documents_content_check check(length(content)<=2000000);
create index if not exists s13_documents_preloaded_idx on public.s13_documents(is_preloaded) where is_preloaded;

create or replace function public.s13_match_chunks(p_session_hash text,p_document_id uuid,p_embedding extensions.vector(512),p_threshold double precision default 0.35,p_count integer default 4)
returns table(content text,section text,"position" integer,similarity double precision)
language sql stable set search_path=public,extensions as $$
 select c.content,c.section,c."position",1-(c.embedding <=> p_embedding) as similarity
 from public.s13_chunks c join public.s13_documents d on d.id=c.document_id
 where d.id=p_document_id and (d.session_hash=p_session_hash or d.is_preloaded=true)
   and d.status='ready' and 1-(c.embedding <=> p_embedding)>=p_threshold
 order by c.embedding <=> p_embedding limit least(greatest(p_count,1),4);
$$;
-- Browser clients cannot list, edit, or publish corpus rows directly.
alter table public.s13_documents enable row level security;
alter table public.s13_chunks enable row level security;
revoke all on public.s13_documents, public.s13_chunks from anon, authenticated;
grant all on public.s13_documents, public.s13_chunks to service_role;
revoke all on function public.s13_match_chunks(text,uuid,extensions.vector,double precision,integer) from public,anon,authenticated;
grant execute on function public.s13_match_chunks(text,uuid,extensions.vector,double precision,integer) to service_role;
notify pgrst, 'reload schema';
