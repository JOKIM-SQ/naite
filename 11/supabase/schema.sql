-- S11 isolated storage. No grants to browser clients.
create table if not exists public.s11_tickets (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
 run_token uuid not null default gen_random_uuid(),
 subject text not null, message text not null, customer_name text not null,
 channel text not null check(channel in ('email','chat','web')),
 demo_mode text not null default 'none' check(demo_mode in ('none','transient','permanent')),
 status text not null default 'queued' check(status in ('queued','classifying','drafting','retrying','completed','failed')),
 category text check(category in ('billing','account','technical','delivery','other')),
 priority text check(priority in ('low','normal','high')),
 confidence double precision check(confidence between 0 and 1),
 needs_review boolean not null default false, review_reason text, reason text, draft text, error text,
 attempts integer not null default 0, events jsonb not null default '[]',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz
);
create index if not exists s11_tickets_workspace_created on public.s11_tickets(workspace_id, created_at desc);
alter table public.s11_tickets enable row level security;
revoke all on public.s11_tickets from public, anon, authenticated;
grant all on public.s11_tickets to service_role;

-- Row lock + token check make event append and state mutation one transaction.
create or replace function public.s11_mutate(p_id uuid, p_token uuid, p_patch jsonb, p_event jsonb)
returns setof public.s11_tickets language plpgsql security invoker set search_path = public as $$
declare r public.s11_tickets;
begin
 select * into r from public.s11_tickets where id=p_id and run_token=p_token for update;
 if not found or r.status in ('completed','failed') then return; end if;
 if p_event is not null and exists(select 1 from jsonb_array_elements(r.events) e where e->>'id'=p_event->>'id') then return next r; return; end if;
 update public.s11_tickets set
 status=coalesce(p_patch->>'status',status),
 category=coalesce(p_patch->>'category',category), priority=coalesce(p_patch->>'priority',priority),
 confidence=coalesce((p_patch->>'confidence')::double precision,confidence),
 needs_review=coalesce((p_patch->>'needs_review')::boolean,needs_review),
 review_reason=coalesce(p_patch->>'review_reason',review_reason), reason=coalesce(p_patch->>'reason',reason),
 draft=coalesce(p_patch->>'draft',draft), error=case when p_patch ? 'error' then p_patch->>'error' else error end,
 attempts=greatest(attempts,coalesce((p_patch->>'attempts')::integer,attempts)),
 completed_at=case when p_patch->>'status'='completed' then now() else completed_at end,
 events=case when p_event is null then events else events || jsonb_build_array(p_event) end, updated_at=now()
 where id=p_id and run_token=p_token returning * into r;
 return next r;
end $$;

create or replace function public.s11_retry(p_id uuid,p_workspace uuid,p_token uuid,p_demo text)
returns setof public.s11_tickets language sql security invoker set search_path = public as $$
 update public.s11_tickets set run_token=p_token,status='queued',demo_mode=p_demo,
 category=null,priority=null,confidence=null,needs_review=false,review_reason=null,reason=null,draft=null,error=null,
 attempts=0,completed_at=null,updated_at=now(),
 events=events || jsonb_build_array(jsonb_build_object('id',p_token::text || ':queued','at',now(),'stage','queued','message','다시 접수했습니다.','attempt',0))
 where id=p_id and workspace_id=p_workspace and status='failed' and p_demo in ('none','transient','permanent') returning *;
$$;
revoke all on function public.s11_mutate(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.s11_retry(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.s11_mutate(uuid,uuid,jsonb,jsonb) to service_role;
grant execute on function public.s11_retry(uuid,uuid,uuid,text) to service_role;
