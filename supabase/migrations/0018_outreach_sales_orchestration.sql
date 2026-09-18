-- ============================================================
-- Silvijn Studio AI — Fase E: Outreach + Sales-orchestratie
--
-- 1. outreach_commands: command-record per expliciete owner-opdracht
--    (mirror van discovery_runs uit 0017). Outreach start uitsluitend
--    na zo'n opdracht; mode 'review' (default, menselijke review per
--    draft) of 'auto' (autonoom verzenden binnen de expliciete opdracht).
--
-- 2. transition_lead_automated: service-role transitie met een harde
--    AI-whitelist. De bestaande menselijke gates blijven onaangetast:
--    silvijn_approval, price_presented, price_accepted, payment_pending,
--    deposit_paid, paid, in_progress, ready_for_silvijn,
--    final_payment_pending, paid_in_full, approved, delivered, won en lost
--    zijn voor de automatische weg NOOIT bereikbaar. De bestaande
--    bewijsguards (sent outreach evidence, price evidence, human decision
--    immutability) uit 0012 blijven integraal gelden via de triggers.
-- ============================================================

begin;

create table public.outreach_commands (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id),
  command text not null,
  mode text not null check (mode in ('review', 'auto')),
  requested_limit integer not null check (requested_limit between 1 and 25),
  effective_limit integer not null check (effective_limit between 1 and 25),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  selected_leads integer not null default 0,
  drafts_created integer,
  quality_failed integer,
  sent integer,
  skipped integer,
  replied_stopped integer,
  followup_stopped integer,
  duration_ms integer,
  selected_lead_ids uuid[] not null default '{}',
  summary jsonb not null default '{}',
  errors jsonb not null default '[]' check (jsonb_typeof(errors) = 'array'),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.outreach_commands enable row level security;

create index if not exists idx_outreach_commands_owner on public.outreach_commands (owner_user_id);
create index if not exists idx_outreach_commands_started_at on public.outreach_commands (started_at desc);

create trigger set_outreach_commands_updated_at
  before update on public.outreach_commands
  for each row execute function public.set_updated_at();

-- Eigenaar leest zijn opdrachten; schrijven verloopt uitsluitend
-- server-side via de service-role (zoals discovery_runs).
create policy outreach_commands_owner_read on public.outreach_commands
  for select to authenticated
  using (public.is_studio_owner());

revoke all on public.outreach_commands from anon;
grant select on public.outreach_commands to authenticated;

-- ------------------------------------------------------------
-- transition_lead_automated — AI-toegestane lead-transities.
-- Toegang: ALLEEN service_role (geen browsersessie kan dit aanroepen;
-- de menselijke transition_lead uit 0012 blijft de eigenaar-weg).
-- Dezelfde bewijsguards uit 0012 (sent outreach evidence, scope)
-- gelden integraal omdat de update dezelfde triggers raakt.
-- ------------------------------------------------------------
create or replace function public.transition_lead_automated(
  p_lead uuid,
  p_expected text,
  p_next text,
  p_reason text,
  p_message uuid default null
) returns void
language plpgsql security definer set search_path='' as $$
declare l public.leads;
begin
  -- AI-whitelist: de automatische weg bereikt NOOIT een menselijke gate
  -- of een financiële/leveringsstatus.
  if p_next not in ('contacted','demo_offered','demo_sent','interested','demo_interested',
                    'website_interested','qualifying','price_ready','opted_out','not_interested') then
    raise exception 'AUTOMATED_TRANSITION_FORBIDDEN: "%" is geen AI-toegestane status', p_next;
  end if;

  if p_reason is null or length(btrim(p_reason)) not between 3 and 2000 then
    raise exception 'TRANSITION_REASON_REQUIRED';
  end if;

  select * into strict l from public.leads where id = p_lead for update;
  if l.lead_status is distinct from p_expected then
    raise exception 'STALE_LEAD_STATE_REFRESH_REQUIRED';
  end if;
  if l.lead_status = p_next then return; end if;

  update public.leads
     set lead_status = p_next,
         status_reason = btrim(p_reason),
         status_evidence_message_id = coalesce(p_message, l.status_evidence_message_id)
   where id = p_lead;
end $$;

revoke all on function public.transition_lead_automated(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.transition_lead_automated(uuid, text, text, text, uuid) to service_role;

insert into public.studio_schema_migrations(version) values('0018_outreach_sales_orchestration');

commit;
