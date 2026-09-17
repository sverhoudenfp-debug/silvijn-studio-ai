-- Data-preserving security and human-control foundation. No existing rows deleted.
begin;
create table public.studio_members (
  email text primary key check (email=lower(email)),
  role text not null check (role in ('owner')),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
-- The studio mailbox is specified in Masterconfig. No password or account is created.
insert into public.studio_members(email,role) values ('silvijn@silvijnstudio.com','owner');
alter table public.studio_members enable row level security;
create policy member_self_read on public.studio_members for select to authenticated
  using (email=lower(auth.jwt()->>'email'));
grant select on public.studio_members to authenticated;
revoke all on public.studio_members from anon,service_role;

create function public.is_studio_owner() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users u join public.studio_members m on m.email=lower(u.email)
    where u.id=auth.uid() and u.email_confirmed_at is not null and m.enabled and m.role='owner');
$$;
revoke all on function public.is_studio_owner() from public;
grant execute on function public.is_studio_owner() to authenticated,service_role;

create table public.audit_events (
 id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users(id),
 action text not null, entity_type text not null, entity_id text not null,
 details jsonb not null default '{}', created_at timestamptz not null default now()
);
create index audit_events_entity on public.audit_events(entity_type,entity_id,created_at desc);
create table public.price_approvals (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id),
 indication_id text not null references public.price_indications(id),
 amount numeric(12,2) not null check(amount>0), currency text not null default 'EUR' check(currency='EUR'),
 reason text not null default '', scope_snapshot jsonb not null, actor_id uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create index price_approvals_project on public.price_approvals(project_id,created_at desc);
alter table public.projects add column price_approval_id uuid references public.price_approvals(id),
 add column payment_plan text check(payment_plan in ('full','split')),
 add column requirements_complete boolean not null default false;
create table public.payment_events (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id),
 approval_id uuid not null references public.price_approvals(id),
 amount numeric(12,2) not null check(amount>0), reference text not null check(length(btrim(reference)) between 1 and 500),
 actor_id uuid not null references auth.users(id), idempotency_key uuid not null unique,
 created_at timestamptz not null default now()
);
create index payment_events_project on public.payment_events(project_id,created_at);
create table public.studio_settings (
 key text primary key, value jsonb not null, updated_at timestamptz not null default now()
);
insert into public.studio_settings values ('pricing','{"currency":"EUR","firstPage":895,"extraPage":200,"webshopFrom":2495,"vatRate":null,"version":"master-2026-09-17"}',now());

-- Owner-only reads, no customer access to the internal CRM. Public forms/previews use narrow routes.
do $$ declare t text; begin
 foreach t in array array['leads','demo_websites','ai_activities','ai_runs','outreach_drafts','inbound_messages','sales_interactions','projects','price_indications','generated_websites','quality_controls','automations','automation_runs','automation_events','automation_queue','audit_events','price_approvals','payment_events','studio_settings'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy studio_owner_read on public.%I for select to authenticated using (public.is_studio_owner())',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('revoke insert,update,delete on public.%I from authenticated,anon',t);
 end loop;
end $$;
-- The elevated application client cannot fabricate a human approval/payment/audit.
revoke all on public.audit_events,public.price_approvals,public.payment_events,public.studio_settings from anon,service_role;
grant select on public.audit_events,public.price_approvals,public.payment_events,public.studio_settings to service_role;

create function public.guard_human_project_fields() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.price_status='approved' and old.price_status is distinct from new.price_status)
 or old.price_approval_id is distinct from new.price_approval_id
 or old.payment_plan is distinct from new.payment_plan
 or (old.price_status='approved' and (old.estimated_price is distinct from new.estimated_price or old.price_status is distinct from new.price_status))
 or (new.status in ('approved','in_progress','completed') and old.status is distinct from new.status)
 then
   if not public.is_studio_owner() then raise exception 'HUMAN_AUTHORIZATION_REQUIRED' using errcode='42501'; end if;
 end if;
 return new;
end $$;
create trigger enforce_human_project_fields before update on public.projects for each row execute function public.guard_human_project_fields();

create function public.guard_human_website_approval() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='approved' and (TG_OP='INSERT' or old.status is distinct from new.status) then
  if not public.is_studio_owner() then raise exception 'HUMAN_AUTHORIZATION_REQUIRED' using errcode='42501'; end if;
 end if;
 return new;
end $$;
create trigger enforce_human_website_approval before insert or update on public.generated_websites for each row execute function public.guard_human_website_approval();

create function public.approve_project_price(p_project uuid,p_amount numeric default null,p_reason text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.projects; i public.price_indications; a uuid; total numeric(12,2);
begin
 if not public.is_studio_owner() then raise exception 'HUMAN_AUTHORIZATION_REQUIRED' using errcode='42501'; end if;
 select * into strict p from public.projects where id=p_project for update;
 select * into strict i from public.price_indications where project_id=p_project order by calculated_at desc,id desc limit 1;
 if i.status not in ('ready','requires_human') or cardinality(i.missing_information)>0 then raise exception 'PRICE_NOT_READY'; end if;
 total:=coalesce(p_amount,i.total);
 if total<=0 then raise exception 'INVALID_AMOUNT'; end if;
 if p_amount is not null and p_amount<>i.total and length(btrim(p_reason))<3 then raise exception 'PRICE_CHANGE_REASON_REQUIRED'; end if;
 if p.price_approval_id is not null then
  if exists(select 1 from public.price_approvals where id=p.price_approval_id and indication_id=i.id and amount=total) then return p.price_approval_id; end if;
  if exists(select 1 from public.payment_events where project_id=p_project) then raise exception 'PAYMENT_EXISTS_REPRICE_REQUIRES_RECONCILIATION'; end if;
 end if;
 insert into public.price_approvals(project_id,indication_id,amount,reason,scope_snapshot,actor_id) values(p_project,i.id,total,left(p_reason,2000),p.requirements,auth.uid()) returning id into a;
 update public.projects set price_status='approved',estimated_price=total,price_approval_id=a where id=p_project;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,details) values(auth.uid(),'price_approved','project',p_project::text,jsonb_build_object('approvalId',a,'amount',total));
 return a;
end $$;

create function public.set_project_payment_plan(p_project uuid,p_plan text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_studio_owner() then raise exception 'HUMAN_AUTHORIZATION_REQUIRED' using errcode='42501'; end if;
 perform 1 from public.projects where id=p_project for update;
 if not found then raise exception 'PROJECT_NOT_FOUND'; end if;
 if p_plan not in ('full','split') then raise exception 'INVALID_PAYMENT_PLAN'; end if;
 if exists(select 1 from public.payment_events where project_id=p_project) then raise exception 'PAYMENT_EXISTS_PLAN_LOCKED'; end if;
 update public.projects set payment_plan=p_plan where id=p_project;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,details) values(auth.uid(),'payment_plan_set','project',p_project::text,jsonb_build_object('plan',p_plan));
end $$;

create function public.confirm_project_payment(p_project uuid,p_amount numeric,p_reference text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.projects; approved numeric; paid numeric; e public.payment_events; event_id uuid;
begin
 if not public.is_studio_owner() then raise exception 'HUMAN_AUTHORIZATION_REQUIRED' using errcode='42501'; end if;
 select * into strict p from public.projects where id=p_project for update;
 select * into e from public.payment_events where idempotency_key=p_key;
 if found then
  if e.project_id<>p_project or e.amount<>p_amount or e.reference<>btrim(p_reference) then raise exception 'IDEMPOTENCY_KEY_CONFLICT'; end if;
  return e.id;
 end if;
 if p.price_status<>'approved' or p.price_approval_id is null or p.payment_plan is null then raise exception 'APPROVED_PRICE_AND_PAYMENT_PLAN_REQUIRED'; end if;
 if p_amount<=0 or p_amount<>round(p_amount,2) or length(btrim(p_reference)) not between 1 and 500 then raise exception 'INVALID_PAYMENT'; end if;
 select amount into strict approved from public.price_approvals where id=p.price_approval_id;
 select coalesce(sum(amount),0) into paid from public.payment_events where project_id=p_project;
 if paid+p_amount>approved then raise exception 'PAYMENT_EXCEEDS_APPROVED_TOTAL'; end if;
 insert into public.payment_events(project_id,approval_id,amount,reference,actor_id,idempotency_key) values(p_project,p.price_approval_id,p_amount,btrim(p_reference),auth.uid(),p_key) returning id into event_id;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,details) values(auth.uid(),'payment_confirmed','project',p_project::text,jsonb_build_object('paymentEventId',event_id,'amount',p_amount));
 return event_id;
end $$;

create function public.project_production_gate(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.projects; approved numeric; paid numeric; required numeric;
begin
 if not public.is_studio_owner() and coalesce(auth.role(),'')<>'service_role' then raise exception 'AUTHORIZATION_REQUIRED' using errcode='42501'; end if;
 select * into strict p from public.projects where id=p_project;
 select amount into approved from public.price_approvals where id=p.price_approval_id;
 select coalesce(sum(amount),0) into paid from public.payment_events where project_id=p_project and approval_id=p.price_approval_id;
 required:=case when p.payment_plan='split' then round(approved/2,2) else approved end;
 return jsonb_build_object('allowed',coalesce(p.price_status='approved' and p.payment_plan is not null and approved>0 and paid>=required and p.requirements_complete and exists(select 1 from public.price_approvals a where a.id=p.price_approval_id and a.scope_snapshot=p.requirements) and p.status not in ('cancelled','completed'),false),'paid',paid,'approved',approved,'required',required,'requirementsComplete',p.requirements_complete,'fullyPaid',coalesce(paid>=approved and approved>0,false));
end $$;

create function public.approve_studio_website(p_website uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare w public.generated_websites; q public.quality_controls;
begin
 if not public.is_studio_owner() then raise exception 'HUMAN_AUTHORIZATION_REQUIRED' using errcode='42501'; end if;
 select * into strict w from public.generated_websites where id=p_website for update;
 select * into strict q from public.quality_controls where generated_website_id=w.id order by created_at desc,id desc limit 1 for update;
 if w.status='approved' then return w.id; end if;
 if w.framework<>'shopify' or q.mode<>'live' or w.status<>'ready_for_silvijn' or w.build_status<>'passed' or q.status<>'completed' or q.overall_result<>'pass' or q.website_version<>w.version
 or exists(select 1 from jsonb_array_elements(q.issues) issue where lower(issue->>'severity') in ('critical','blocking','error'))
 or exists(select 1 from jsonb_array_elements(q.checks) c where c->>'category'='security' and c->>'result'='failed')
 then raise exception 'QC_APPROVAL_GATE_FAILED'; end if;
 if not (public.project_production_gate(w.project_id)->>'allowed')::boolean then raise exception 'PRODUCTION_GATE_FAILED'; end if;
 update public.quality_controls set approval=jsonb_build_object('action','approved','by',auth.uid(),'at',now(),'websiteVersion',w.version) where id=q.id;
 update public.generated_websites set status='approved' where id=w.id;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,details) values(auth.uid(),'website_approved','website',w.id::text,jsonb_build_object('version',w.version,'qcId',q.id));
 return w.id;
end $$;

-- Definer RPCs require a verified owner internally; service role cannot call human endpoints.
revoke all on function public.approve_project_price(uuid,numeric,text),public.set_project_payment_plan(uuid,text),public.confirm_project_payment(uuid,numeric,text,uuid),public.approve_studio_website(uuid) from public,anon,service_role;
grant execute on function public.approve_project_price(uuid,numeric,text),public.set_project_payment_plan(uuid,text),public.confirm_project_payment(uuid,numeric,text,uuid),public.approve_studio_website(uuid) to authenticated;
revoke all on function public.project_production_gate(uuid) from public,anon;
grant execute on function public.project_production_gate(uuid) to authenticated,service_role;


create function public.reject_project_price(p_project uuid,p_reason text default '') returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_studio_owner() then raise exception 'HUMAN_AUTHORIZATION_REQUIRED' using errcode='42501'; end if;
 perform 1 from public.projects where id=p_project for update;
 if not found then raise exception 'PROJECT_NOT_FOUND'; end if;
 if exists(select 1 from public.payment_events where project_id=p_project) then raise exception 'PAYMENT_EXISTS_REPRICE_REQUIRES_RECONCILIATION'; end if;
 update public.projects set price_status='rejected',price_approval_id=null where id=p_project;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,details) values(auth.uid(),'price_rejected','project',p_project::text,jsonb_build_object('reason',left(p_reason,2000)));
end $$;
create function public.set_studio_project_status(p_project uuid,p_status text) returns void
language plpgsql security definer set search_path='' as $$
declare p public.projects; permitted text[];
begin
 if not public.is_studio_owner() then raise exception 'HUMAN_AUTHORIZATION_REQUIRED' using errcode='42501'; end if;
 select * into strict p from public.projects where id=p_project for update;
 if p.status=p_status then return; end if;
 permitted:=case p.status
 when 'quotation_pending' then array['price_ready','awaiting_approval','cancelled']
 when 'price_ready' then array['awaiting_approval','quotation_pending','cancelled']
 when 'awaiting_approval' then array['approved','price_ready','cancelled']
 when 'approved' then array['in_progress','cancelled']
 when 'in_progress' then array['ready_for_review','cancelled']
 when 'ready_for_review' then array['in_progress'] else array[]::text[] end;
 if not p_status=any(permitted) then raise exception 'INVALID_PROJECT_TRANSITION'; end if;
 if p_status='approved' and p.price_status<>'approved' then raise exception 'APPROVED_PRICE_REQUIRED'; end if;
 if p_status='in_progress' and not (public.project_production_gate(p_project)->>'allowed')::boolean then raise exception 'PRODUCTION_GATE_FAILED'; end if;
 update public.projects set status=p_status where id=p_project;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,details) values(auth.uid(),'project_status_changed','project',p_project::text,jsonb_build_object('from',p.status,'to',p_status));
end $$;
revoke all on function public.reject_project_price(uuid,text),public.set_studio_project_status(uuid,text) from public,anon,service_role;
grant execute on function public.reject_project_price(uuid,text),public.set_studio_project_status(uuid,text) to authenticated;

create table public.studio_schema_migrations(version text primary key,applied_at timestamptz not null default now());
alter table public.studio_schema_migrations enable row level security;
revoke all on public.studio_schema_migrations from anon,authenticated,service_role;
insert into public.studio_schema_migrations(version) values('0010_studio_security_finance');
commit;
