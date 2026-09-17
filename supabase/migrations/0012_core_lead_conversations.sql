-- Core lifecycle only. Reuses leads, outreach_drafts and inbound_messages.
-- No mail sending, generation, questionnaires or analytics. No legacy row is rewritten/deleted.
begin;
create table public.lead_contacts (
 id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.leads(id),
 channel text not null check(channel in ('email','linkedin','phone','other')),
 address text not null check(length(btrim(address)) between 1 and 500),
 created_at timestamptz not null default now(),
 unique(lead_id,channel,address), unique(id,lead_id,channel)
);
alter table public.projects add constraint projects_id_lead_unique unique(id,lead_id);
alter table public.price_approvals add constraint price_approvals_id_project_unique unique(id,project_id);
alter table public.outreach_drafts
 add column contact_id uuid,
 add column conversation_id uuid,
 add column project_id uuid,
 add column price_approval_id uuid,
 add column purpose text not null default 'initial' check(purpose in ('initial','followup','demo_offer','demo_link','price_offer','sales_reply')),
 add column sent_at timestamptz,
 add constraint outreach_contact_lead_fk foreign key(contact_id,lead_id,channel) references public.lead_contacts(id,lead_id,channel),
 add constraint outreach_project_lead_fk foreign key(project_id,lead_id) references public.projects(id,lead_id),
 add constraint outreach_price_project_fk foreign key(price_approval_id,project_id) references public.price_approvals(id,project_id),
 add constraint outreach_price_requires_project check(price_approval_id is null or project_id is not null),
 add constraint outreach_identity_unique unique(id,lead_id,contact_id,channel);
alter table public.inbound_messages
 add column contact_id uuid,
 add column conversation_id uuid,
 add column in_reply_to_outreach_id uuid,
 add column reply_confirmed boolean not null default false,
 add column confirmed_by uuid references auth.users(id),
 add column request_key uuid unique,
 add column thread_key text not null default 'manual' check(length(thread_key) between 1 and 300),
 add constraint inbound_contact_lead_fk foreign key(contact_id,lead_id,channel) references public.lead_contacts(id,lead_id,channel),
 add constraint inbound_reply_outreach_fk foreign key(in_reply_to_outreach_id,lead_id,contact_id,channel) references public.outreach_drafts(id,lead_id,contact_id,channel),
 add constraint inbound_conversation_needs_reply check(conversation_id is null or (contact_id is not null and reply_confirmed)),
 add constraint inbound_reply_needs_contact check(in_reply_to_outreach_id is null or contact_id is not null),
 add constraint inbound_confirmed_evidence check(not reply_confirmed or (contact_id is not null and confirmed_by is not null and length(btrim(body))>0)),
 add constraint inbound_id_lead_unique unique(id,lead_id),
 add constraint inbound_first_reply_unique unique(id,lead_id,contact_id,channel,reply_confirmed);
-- Existing unverified/manual/mock rows stay unverified. In particular, no mock row activates a conversation.
create table public.conversations (
 id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.leads(id),
 contact_id uuid not null, channel text not null, thread_key text not null,
 first_reply_id uuid not null unique, first_reply_confirmed boolean not null default true check(first_reply_confirmed),
 created_at timestamptz not null default now(), last_reply_at timestamptz not null,
 unique(lead_id,contact_id,channel,thread_key), unique(id,lead_id,contact_id,channel),
 constraint conversation_contact_lead_fk foreign key(contact_id,lead_id,channel) references public.lead_contacts(id,lead_id,channel),
 constraint conversation_real_reply_fk foreign key(first_reply_id,lead_id,contact_id,channel,first_reply_confirmed)
 references public.inbound_messages(id,lead_id,contact_id,channel,reply_confirmed)
);
alter table public.inbound_messages add constraint inbound_conversation_scope_fk
 foreign key(conversation_id,lead_id,contact_id,channel) references public.conversations(id,lead_id,contact_id,channel);
alter table public.outreach_drafts add constraint outreach_conversation_scope_fk
 foreign key(conversation_id,lead_id,contact_id,channel) references public.conversations(id,lead_id,contact_id,channel),
 add constraint outreach_conversation_needs_contact check(conversation_id is null or contact_id is not null);
alter table public.sales_interactions add constraint sales_message_lead_fk
 foreign key(inbound_message_id,lead_id) references public.inbound_messages(id,lead_id);
alter table public.leads add column status_reason text not null default '', add column status_evidence_message_id uuid,
 add constraint lead_state_evidence_scope_fk foreign key(status_evidence_message_id,id) references public.inbound_messages(id,lead_id);
create index conversations_recent_idx on public.conversations(last_reply_at desc,id);
create index conversations_lead_idx on public.conversations(lead_id);
create index inbound_conversation_order_idx on public.inbound_messages(conversation_id,received_at,id);
create index outreach_conversation_order_idx on public.outreach_drafts(conversation_id,sent_at,id);
create index outreach_lead_status_idx on public.outreach_drafts(lead_id,status,created_at desc);
create index leads_lifecycle_idx on public.leads(lead_status,updated_at desc);
alter table public.lead_contacts enable row level security;
alter table public.conversations enable row level security;
create policy studio_owner_read on public.lead_contacts for select to authenticated using(public.is_studio_owner());
create policy studio_owner_read on public.conversations for select to authenticated using(public.is_studio_owner());
revoke all on public.lead_contacts,public.conversations from anon,authenticated,service_role;
grant select on public.lead_contacts,public.conversations to authenticated,service_role;

create function public.guard_message_identity() returns trigger language plpgsql set search_path='' as $$
declare contact_address text;
begin
 if TG_OP='UPDATE' and (old.lead_id<>new.lead_id or old.channel<>new.channel or old.contact_id is distinct from new.contact_id) then
  raise exception 'MESSAGE_IDENTITY_IMMUTABLE';
 end if;
 if new.contact_id is not null then
  select address into contact_address from public.lead_contacts where id=new.contact_id and lead_id=new.lead_id and channel=new.channel;
  if contact_address is null or contact_address<>(case when new.channel='email' then lower(btrim(new.sender)) else btrim(new.sender) end) then raise exception 'SENDER_CONTACT_MISMATCH'; end if;
 end if;
 if TG_OP='UPDATE' and old.reply_confirmed and (not new.reply_confirmed or old.confirmed_by is distinct from new.confirmed_by or old.body<>new.body or old.subject<>new.subject or old.source<>new.source or old.in_reply_to_outreach_id is distinct from new.in_reply_to_outreach_id or old.provider_message_id is distinct from new.provider_message_id or old.provider_account_key is distinct from new.provider_account_key or old.sender<>new.sender or old.received_at<>new.received_at or old.thread_key<>new.thread_key or old.request_key is distinct from new.request_key or (old.conversation_id is not null and old.conversation_id is distinct from new.conversation_id)) then raise exception 'CONFIRMED_REPLY_IMMUTABLE'; end if;
 if new.reply_confirmed and (TG_OP='INSERT' or not old.reply_confirmed) then
  if not public.is_studio_owner() or new.confirmed_by is distinct from auth.uid() then raise exception 'VERIFIED_REPLY_CONFIRMATION_REQUIRED' using errcode='42501'; end if;
  if new.source in ('mock','test') then raise exception 'SYNTHETIC_REPLY_CANNOT_ACTIVATE_CONVERSATION'; end if;
  if new.in_reply_to_outreach_id is not null and not exists(select 1 from public.outreach_drafts o where o.id=new.in_reply_to_outreach_id and o.status='sent') then raise exception 'REPLY_TARGET_NOT_SENT'; end if;
 end if;
 return new;
end $$;
create trigger guard_inbound_identity before insert or update on public.inbound_messages for each row execute function public.guard_message_identity();

create function public.attach_confirmed_reply() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
 if not new.reply_confirmed then return new; end if;
 if TG_OP='UPDATE' and old.reply_confirmed then return new; end if;
 insert into public.conversations(lead_id,contact_id,channel,thread_key,first_reply_id,last_reply_at)
 values(new.lead_id,new.contact_id,new.channel,new.thread_key,new.id,new.received_at)
 on conflict(lead_id,contact_id,channel,thread_key) do update set last_reply_at=greatest(public.conversations.last_reply_at,excluded.last_reply_at) returning id into cid;
 update public.inbound_messages set conversation_id=cid where id=new.id;
 if new.in_reply_to_outreach_id is not null then
  if exists(select 1 from public.outreach_drafts where id=new.in_reply_to_outreach_id and conversation_id is not null and conversation_id<>cid) then raise exception 'OUTREACH_THREAD_MISMATCH'; end if;
  update public.outreach_drafts set conversation_id=cid where id=new.in_reply_to_outreach_id;
 end if;
 update public.leads set outreach_status='replied' where id=new.lead_id and outreach_status<>'opted_out';
 insert into public.audit_events(actor_id,action,entity_type,entity_id,details) values(auth.uid(),'prospect_reply_recorded','lead',new.lead_id::text,jsonb_build_object('messageId',new.id,'conversationId',cid,'source',new.source));
 return new;
end $$;
create trigger attach_actual_reply after insert or update of reply_confirmed on public.inbound_messages for each row execute function public.attach_confirmed_reply();

create function public.record_prospect_reply(p_lead uuid,p_channel text,p_sender text,p_subject text,p_body text,p_received timestamptz,p_key uuid,p_outreach uuid default null,p_thread text default 'manual') returns uuid
language plpgsql security definer set search_path='' as $$
declare normalized_sender text; cid uuid; mid uuid; prior public.inbound_messages;
begin
 if not public.is_studio_owner() then raise exception 'HUMAN_AUTHORIZATION_REQUIRED' using errcode='42501'; end if;
 if p_key is null or p_received is null or p_received>now()+interval '5 minutes' or p_channel is null or p_channel not in ('email','linkedin','phone','other') or p_sender is null or length(btrim(p_sender)) not between 1 and 500 or p_body is null or length(btrim(p_body)) not between 1 and 50000 or p_subject is null or length(p_subject)>1000 or p_thread is null or length(p_thread) not between 1 and 300 then raise exception 'INVALID_REPLY'; end if;
 perform 1 from public.leads where id=p_lead for update;
 if not found then raise exception 'LEAD_NOT_FOUND'; end if;
 normalized_sender:=case when p_channel='email' then lower(btrim(p_sender)) else btrim(p_sender) end;
 select * into prior from public.inbound_messages where request_key=p_key;
 if found then
  if prior.lead_id<>p_lead or prior.channel<>p_channel or prior.sender<>normalized_sender or prior.subject<>p_subject or prior.body<>btrim(p_body) or prior.received_at<>p_received or prior.in_reply_to_outreach_id is distinct from p_outreach or prior.thread_key<>p_thread then raise exception 'IDEMPOTENCY_KEY_CONFLICT'; end if;
  return prior.id;
 end if;
 insert into public.lead_contacts(lead_id,channel,address) values(p_lead,p_channel,normalized_sender)
 on conflict(lead_id,channel,address) do update set address=excluded.address returning id into cid;
 insert into public.inbound_messages(lead_id,contact_id,channel,sender,subject,body,received_at,source,reply_confirmed,confirmed_by,request_key,in_reply_to_outreach_id,thread_key)
 values(p_lead,cid,p_channel,normalized_sender,p_subject,btrim(p_body),p_received,'manual_verified',true,auth.uid(),p_key,p_outreach,p_thread) returning id into mid;
 return mid;
end $$;
revoke all on function public.record_prospect_reply(uuid,text,text,text,text,timestamptz,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.record_prospect_reply(uuid,text,text,text,text,timestamptz,uuid,uuid,text) to authenticated;

-- Lifecycle graph and guarded transitions follow, generated from lib/leads/lifecycle.json.
alter table public.leads add column status_project_id uuid, add constraint lead_state_project_scope_fk foreign key(status_project_id,id) references public.projects(id,lead_id);
alter table public.leads drop constraint leads_lead_status_check;
alter table public.leads add constraint leads_lead_status_check check(lead_status in ('new','analyzing','qualified','contacted','interested','demo_offered','demo_interested','demo_sent','website_interested','qualifying','price_ready','silvijn_approval','price_presented','price_accepted','payment_pending','deposit_paid','paid','in_progress','ready_for_silvijn','final_payment_pending','paid_in_full','approved','delivered','won','not_interested','opted_out','lost'));
create function public.lead_transition_allowed(p_from text,p_to text) returns boolean language sql immutable set search_path='' as $$ select coalesce(p_from=p_to or (('{"new":["analyzing","contacted","qualified","interested","demo_offered","website_interested","not_interested","opted_out","lost"],"analyzing":["qualified","contacted","interested","demo_offered","website_interested","not_interested","opted_out","lost"],"qualified":["contacted","demo_offered","demo_interested","website_interested","qualifying","not_interested","opted_out","lost"],"contacted":["interested","demo_offered","demo_interested","website_interested","qualifying","not_interested","opted_out","lost"],"interested":["qualified","demo_interested","website_interested","qualifying","not_interested","opted_out","lost"],"demo_offered":["demo_interested","website_interested","not_interested","opted_out","lost"],"demo_interested":["demo_sent","website_interested","not_interested","opted_out","lost"],"demo_sent":["website_interested","qualifying","not_interested","opted_out","lost"],"website_interested":["qualifying","not_interested","opted_out","lost"],"qualifying":["price_ready","not_interested","opted_out","lost"],"price_ready":["silvijn_approval","qualifying","not_interested","opted_out","lost"],"silvijn_approval":["price_presented","qualifying","not_interested","opted_out","lost"],"price_presented":["price_accepted","qualifying","not_interested","opted_out","lost"],"price_accepted":["payment_pending","not_interested","opted_out","lost"],"payment_pending":["deposit_paid","paid","in_progress","not_interested","opted_out","lost"],"deposit_paid":["in_progress","paid_in_full","not_interested","opted_out","lost"],"paid":["in_progress","not_interested","opted_out","lost"],"in_progress":["ready_for_silvijn","final_payment_pending","paid_in_full","not_interested","opted_out","lost"],"ready_for_silvijn":["in_progress","approved","final_payment_pending","paid_in_full","not_interested","opted_out","lost"],"final_payment_pending":["paid_in_full","not_interested","opted_out","lost"],"paid_in_full":["in_progress","ready_for_silvijn","approved","not_interested","opted_out","lost"],"approved":["final_payment_pending","paid_in_full","delivered","not_interested","opted_out","lost"],"delivered":["opted_out"],"won":["opted_out"],"not_interested":["analyzing","opted_out"],"opted_out":[],"lost":["analyzing","opted_out"]}'::jsonb)->p_from) ? p_to,false); $$;
create function public.guard_lead_lifecycle() returns trigger language plpgsql set search_path='' as $$
declare p public.projects; a public.price_approvals; paid numeric; web public.generated_websites;
begin
 if TG_OP='INSERT' then
  if new.lead_status<>'new' then raise exception 'NEW_LEAD_MUST_START_NEW'; end if;
  return new;
 end if;
 if old.lead_status=new.lead_status then
  if old.status_project_id is distinct from new.status_project_id or old.status_evidence_message_id is distinct from new.status_evidence_message_id then raise exception 'STATE_CONTEXT_IMMUTABLE_WITHOUT_TRANSITION'; end if;
  return new;
 end if;
 if not public.lead_transition_allowed(old.lead_status,new.lead_status) then raise exception 'INVALID_LEAD_TRANSITION: % -> %',old.lead_status,new.lead_status; end if;
 if new.lead_status='delivered' then raise exception 'BLOCKED_DELIVERY_WORKFLOW_NOT_IMPLEMENTED'; end if;
 if old.lead_status in ('lost','not_interested') and new.lead_status='analyzing' and not public.is_studio_owner() then raise exception 'HUMAN_REOPEN_REQUIRED' using errcode='42501'; end if;
 if new.lead_status in ('interested','demo_interested','website_interested','qualifying','price_accepted') and not exists(select 1 from public.inbound_messages where lead_id=new.id and reply_confirmed) then raise exception 'CONFIRMED_PROSPECT_REPLY_REQUIRED'; end if;
 if new.lead_status in ('contacted','demo_offered','demo_sent') and not exists(select 1 from public.outreach_drafts where lead_id=new.id and status='sent' and sent_at is not null and (new.lead_status='contacted' or purpose=case when new.lead_status='demo_offered' then 'demo_offer' else 'demo_link' end)) then raise exception 'SENT_OUTREACH_EVIDENCE_REQUIRED'; end if;
 if new.lead_status='demo_sent' and not exists(select 1 from public.demo_websites where lead_id=new.id and status='ready') then raise exception 'READY_DEMO_REQUIRED'; end if;
 if new.lead_status in ('price_ready','silvijn_approval','price_presented','price_accepted','payment_pending','deposit_paid','paid','in_progress','ready_for_silvijn','final_payment_pending','paid_in_full','approved') then
  select * into p from public.projects where id=new.status_project_id and lead_id=new.id;
  if p.id is null or p.status in ('cancelled','completed') then raise exception 'ACTIVE_SCOPED_PROJECT_REQUIRED'; end if;
  if new.lead_status in ('price_ready','silvijn_approval') then
   if not exists(select 1 from public.price_indications where id=(select id from public.price_indications where project_id=p.id order by calculated_at desc,id desc limit 1) and total>0 and status in ('ready','requires_human') and cardinality(missing_information)=0) then raise exception 'COMPLETE_PRICE_INDICATION_REQUIRED'; end if;
   return new;
  end if;
  select * into a from public.price_approvals where id=p.price_approval_id and project_id=p.id;
  if p.price_status<>'approved' or a.id is null or a.scope_snapshot is distinct from p.requirements then raise exception 'APPROVED_SCOPE_AND_PRICE_REQUIRED'; end if;
  select coalesce(sum(amount),0) into paid from public.payment_events where project_id=p.id and approval_id=a.id;
  select * into web from public.generated_websites where project_id=p.id and status<>'archived' order by version desc,created_at desc,id desc limit 1;
  if new.lead_status='price_presented' and not exists(select 1 from public.outreach_drafts where lead_id=new.id and project_id=p.id and price_approval_id=a.id and purpose='price_offer' and status='sent' and sent_at is not null) then raise exception 'SENT_APPROVED_PRICE_REQUIRED'; end if;
  if new.lead_status='price_accepted' then
   if not public.is_studio_owner() then raise exception 'HUMAN_ACCEPTANCE_RECORD_REQUIRED' using errcode='42501'; end if;
   if not exists(select 1 from public.inbound_messages i join public.outreach_drafts o on o.id=i.in_reply_to_outreach_id where i.id=new.status_evidence_message_id and i.lead_id=new.id and i.reply_confirmed and o.price_approval_id=a.id and o.purpose='price_offer' and o.status='sent' and i.received_at>=o.sent_at) then raise exception 'PRICE_ACCEPTANCE_REPLY_REQUIRED'; end if;
  end if;
  if new.lead_status='payment_pending' and p.payment_plan is null then raise exception 'PAYMENT_PLAN_REQUIRED'; end if;
  if new.lead_status='deposit_paid' and not coalesce(p.payment_plan='split' and paid>=round(a.amount/2,2) and paid<a.amount,false) then raise exception 'CONFIRMED_DEPOSIT_REQUIRED'; end if;
  if new.lead_status='paid' and not coalesce(p.payment_plan='full' and paid>=a.amount,false) then raise exception 'CONFIRMED_FULL_UPFRONT_PAYMENT_REQUIRED'; end if;
  if new.lead_status='paid_in_full' and paid<a.amount then raise exception 'CONFIRMED_FULL_PAYMENT_REQUIRED'; end if;
  if new.lead_status='in_progress' and (p.status<>'in_progress' or not (public.project_production_gate(p.id)->>'allowed')::boolean) then raise exception 'AUTHORIZED_PRODUCTION_REQUIRED'; end if;
  if new.lead_status='ready_for_silvijn' and (web.id is null or web.status<>'ready_for_silvijn') then raise exception 'READY_WEBSITE_REQUIRED'; end if;
  if new.lead_status='approved' and (not public.is_studio_owner() or web.id is null or web.status<>'approved') then raise exception 'EXISTING_HUMAN_WEBSITE_APPROVAL_REQUIRED'; end if;
  if new.lead_status='final_payment_pending' and (p.payment_plan is distinct from 'split' or paid>=a.amount or paid<round(a.amount/2,2) or web.id is null or web.status not in ('ready_for_silvijn','approved')) then raise exception 'FINAL_PAYMENT_NOT_DUE'; end if;
 end if;
 if new.lead_status='opted_out' then new.outreach_status:='opted_out'; end if;
 return new;
end $$;
create trigger enforce_lead_lifecycle before insert or update on public.leads for each row execute function public.guard_lead_lifecycle();
create function public.audit_lead_transition() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.lead_status<>old.lead_status then
  insert into public.audit_events(actor_id,action,entity_type,entity_id,details) values(auth.uid(),'lead_state_changed','lead',new.id::text,jsonb_build_object('from',old.lead_status,'to',new.lead_status,'reason',new.status_reason,'projectId',new.status_project_id,'messageId',new.status_evidence_message_id,'actorRole',auth.role()));
 end if;
 return new;
end $$;
create trigger audit_lead_lifecycle after update on public.leads for each row execute function public.audit_lead_transition();
create function public.transition_lead(p_lead uuid,p_expected text,p_next text,p_reason text,p_project uuid default null,p_message uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare l public.leads;
begin
 if not public.is_studio_owner() then raise exception 'HUMAN_AUTHORIZATION_REQUIRED' using errcode='42501'; end if;
 if p_next is null or p_reason is null or length(btrim(p_reason)) not between 3 and 2000 then raise exception 'TRANSITION_REASON_REQUIRED'; end if;
 select * into strict l from public.leads where id=p_lead for update;
 if l.lead_status is distinct from p_expected then raise exception 'STALE_LEAD_STATE_REFRESH_REQUIRED'; end if;
 if l.lead_status=p_next then return; end if;
 update public.leads set lead_status=p_next,status_reason=btrim(p_reason),status_project_id=coalesce(p_project,l.status_project_id),status_evidence_message_id=p_message where id=p_lead;
end $$;
revoke all on function public.transition_lead(uuid,text,text,text,uuid,uuid) from public,anon,service_role;
grant execute on function public.transition_lead(uuid,text,text,text,uuid,uuid) to authenticated;

create function public.guard_outreach_scope() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient text;
begin
 if TG_OP='UPDATE' and (new.lead_id<>old.lead_id or new.channel<>old.channel or (old.contact_id is not null and old.contact_id is distinct from new.contact_id)) then raise exception 'OUTREACH_IDENTITY_IMMUTABLE'; end if;
 if new.contact_id is null and new.channel='email' then
  select lower(btrim(email)) into recipient from public.leads where id=new.lead_id;
  if coalesce(recipient,'')<>'' then
   insert into public.lead_contacts(lead_id,channel,address) values(new.lead_id,new.channel,recipient) on conflict(lead_id,channel,address) do update set address=excluded.address returning id into new.contact_id;
  end if;
 end if;
 if new.status='sent' and (TG_OP='INSERT' or old.status<>'sent') then
  if new.contact_id is null or new.sent_at is null then raise exception 'SENT_MESSAGE_REQUIRES_RECIPIENT_AND_TIME'; end if;
  if exists(select 1 from public.leads where id=new.lead_id and (lead_status in ('opted_out','not_interested','lost') or outreach_status='opted_out')) then raise exception 'OUTREACH_SUPPRESSED'; end if;
  if new.purpose='price_offer' and not exists(select 1 from public.projects p join public.price_approvals a on a.id=p.price_approval_id where p.id=new.project_id and p.lead_id=new.lead_id and a.id=new.price_approval_id and p.price_status='approved' and a.scope_snapshot=p.requirements) then raise exception 'OUTREACH_REQUIRES_APPROVED_PRICE'; end if;
 end if;
 if TG_OP='UPDATE' and old.status='sent' and ((old.conversation_id is not null and old.conversation_id is distinct from new.conversation_id) or new.provider_message_id is distinct from old.provider_message_id or new.provider_account_key is distinct from old.provider_account_key or new.status<>'sent' or new.subject<>old.subject or new.body<>old.body or new.sent_at is distinct from old.sent_at or new.project_id is distinct from old.project_id or new.price_approval_id is distinct from old.price_approval_id or new.purpose<>old.purpose) then raise exception 'SENT_OUTREACH_IMMUTABLE'; end if;
 return new;
end $$;
create trigger enforce_outreach_scope before insert or update on public.outreach_drafts for each row execute function public.guard_outreach_scope();
insert into public.studio_schema_migrations(version) values('0012_core_lead_conversations');
-- IN_PROGRESS is operational, not a second human approval. Keep the other human fields protected.
create or replace function public.guard_human_project_fields() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='INSERT' then
  if new.price_status='approved' or new.price_approval_id is not null or new.payment_plan is not null or new.status in ('approved','in_progress','completed') then
   if not public.is_studio_owner() then raise exception 'HUMAN_AUTHORIZATION_REQUIRED' using errcode='42501'; end if;
  end if;
 else
  if (new.price_status='approved' and old.price_status is distinct from new.price_status)
   or old.price_approval_id is distinct from new.price_approval_id
   or old.payment_plan is distinct from new.payment_plan
   or (old.price_status='approved' and (old.estimated_price is distinct from new.estimated_price or old.price_status is distinct from new.price_status))
   or (new.status in ('approved','completed') and old.status is distinct from new.status) then
    if not public.is_studio_owner() then raise exception 'HUMAN_AUTHORIZATION_REQUIRED' using errcode='42501'; end if;
  end if;
  if new.status='in_progress' and old.status<>'in_progress' then
   if (not public.is_studio_owner() and coalesce(auth.role(),'')<>'service_role') or old.status in ('cancelled','completed') or new.requirements is distinct from old.requirements or not new.requirements_complete or new.payment_plan is distinct from old.payment_plan or new.price_approval_id is distinct from old.price_approval_id or not (public.project_production_gate(old.id)->>'allowed')::boolean then raise exception 'PRODUCTION_GATE_FAILED'; end if;
  end if;
 end if;
 return new;
end $$;
create function public.start_project_production(p_project uuid) returns void language plpgsql security definer set search_path='' as $$
declare p public.projects; l public.leads;
begin
 if not public.is_studio_owner() and coalesce(auth.role(),'')<>'service_role' then raise exception 'AUTHORIZATION_REQUIRED' using errcode='42501'; end if;
 select * into strict p from public.projects where id=p_project for update;
 if not (public.project_production_gate(p.id)->>'allowed')::boolean then raise exception 'PRODUCTION_GATE_FAILED'; end if;
 if p.status<>'in_progress' then
  update public.projects set status='in_progress' where id=p.id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,details) values(auth.uid(),'production_started','project',p.id::text,jsonb_build_object('actorRole',auth.role(),'previousState',p.status,'paymentApprovalId',p.price_approval_id));
 end if;
 select * into strict l from public.leads where id=p.lead_id for update;
 if l.lead_status in ('payment_pending','deposit_paid','paid','paid_in_full') then
  update public.leads set lead_status='in_progress',status_project_id=p.id,status_reason='Existing payment and requirements authorize production' where id=l.id;
 end if;
end $$;
revoke all on function public.start_project_production(uuid) from public,anon;
grant execute on function public.start_project_production(uuid) to authenticated,service_role;
alter table public.inbound_messages add column provider_message_id text, add column provider_account_key text,
 add constraint inbound_provider_key_pair check((provider_message_id is null)=(provider_account_key is null)),
 add constraint inbound_provider_dedupe unique(channel,provider_account_key,provider_message_id);
alter table public.outreach_drafts add column provider_message_id text, add column provider_account_key text,
 add constraint outreach_provider_key_pair check((provider_message_id is null)=(provider_account_key is null)),
 add constraint outreach_provider_dedupe unique(channel,provider_account_key,provider_message_id);
create view public.conversation_messages with(security_invoker=true) as
 select id,lead_id,conversation_id,contact_id,channel,'inbound'::text as direction,sender,subject,body,received_at as occurred_at,source from public.inbound_messages where reply_confirmed and conversation_id is not null
 union all
 select id,lead_id,conversation_id,contact_id,channel,'outbound'::text as direction,''::text as sender,subject,body,sent_at as occurred_at,'outreach'::text as source from public.outreach_drafts where status='sent' and conversation_id is not null;
revoke all on public.conversation_messages from anon;
grant select on public.conversation_messages to authenticated,service_role;
revoke all on function public.attach_confirmed_reply(),public.guard_outreach_scope(),public.guard_message_identity(),public.guard_lead_lifecycle(),public.audit_lead_transition() from public,anon,authenticated,service_role;
commit;
