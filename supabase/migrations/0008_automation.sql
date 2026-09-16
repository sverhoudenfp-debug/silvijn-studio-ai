-- ============================================================
-- Silvijn Studio AI — Fase 11: Automation Engine
-- automations (definities) + automation_runs (executies) +
-- automation_events (typed event-log) + automation_queue (queue).
-- RLS aan zonder publiek beleid: uitsluitend server-side toegang
-- via secret key; mutaties lopen alléén via server actions.
-- De engine is een ORCHESTRATOR: safety gates (capability matrix,
-- cost guard, loop protection, idempotency) zijn deterministisch.
-- ============================================================

create table if not exists public.automations (
  id text primary key,
  name text not null,
  description text not null default '',
  type text not null check (type in ('lead_pipeline', 'discovery', 'custom')),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'completed', 'failed', 'disabled')),
  enabled boolean not null default false,
  trigger text not null check (trigger in (
    'lead_created', 'lead_analyzed', 'lead_scored', 'lead_qualified', 'demo_ready',
    'outreach_draft_ready', 'inbound_message_received', 'reply_processed', 'project_created',
    'price_ready', 'website_ready_for_qc', 'qc_completed', 'website_ready_for_silvijn',
    'website_approved', 'manual'
  )),
  steps jsonb not null default '[]',
  current_step text,
  execution_count integer not null default 0,
  success_count integer not null default 0,
  failure_count integer not null default 0,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_runs (
  id text primary key,
  automation_id text not null references public.automations (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled', 'blocked')),
  entity_type text not null check (entity_type in ('lead', 'project', 'website', 'discovery', 'none')),
  entity_id text,
  current_step text,
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  retry_count integer not null default 0,
  waiting_reason text,
  steps jsonb not null default '[]',
  metadata jsonb not null default '{}',
  warnings text[] not null default '{}',
  ai_calls integer not null default 0,
  estimated_cost_usd numeric(10,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_automation_runs_automation_id on public.automation_runs (automation_id);
create index if not exists idx_automation_runs_status on public.automation_runs (status);

create table if not exists public.automation_events (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in (
    'lead_created', 'lead_analyzed', 'lead_scored', 'lead_qualified', 'demo_ready',
    'outreach_draft_ready', 'inbound_message_received', 'reply_processed', 'project_created',
    'price_ready', 'website_ready_for_qc', 'qc_completed', 'website_ready_for_silvijn',
    'website_approved', 'automation_started', 'automation_step_started',
    'automation_step_completed', 'automation_step_failed', 'automation_step_blocked',
    'automation_waiting_for_human', 'automation_completed', 'automation_failed',
    'automation_cancelled'
  )),
  entity_type text not null check (entity_type in ('lead', 'project', 'website', 'discovery', 'none')),
  entity_id text,
  timestamp timestamptz not null default now(),
  payload jsonb not null default '{}',
  source text not null default '',
  -- Idempotency-hulp: dubbele events op exact hetzelfde moment voorkomen
  created_at timestamptz not null default now()
);

create index if not exists idx_automation_events_timestamp on public.automation_events (timestamp desc);
create index if not exists idx_automation_events_entity on public.automation_events (entity_type, entity_id);

create table if not exists public.automation_queue (
  id uuid primary key default gen_random_uuid(),
  automation_id text not null references public.automations (id) on delete cascade,
  entity_type text not null check (entity_type in ('lead', 'project', 'website', 'discovery', 'none')),
  entity_id text,
  trigger_event text not null check (trigger_event in (
    'lead_created', 'lead_analyzed', 'lead_scored', 'lead_qualified', 'demo_ready',
    'outreach_draft_ready', 'inbound_message_received', 'reply_processed', 'project_created',
    'price_ready', 'website_ready_for_qc', 'qc_completed', 'website_ready_for_silvijn',
    'website_approved', 'manual'
  )),
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  attempts integer not null default 0,
  enqueued_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

create index if not exists idx_automation_queue_status on public.automation_queue (status, enqueued_at);

alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;
alter table public.automation_events enable row level security;
alter table public.automation_queue enable row level security;

create trigger set_automations_updated_at
  before update on public.automations
  for each row execute function public.set_updated_at();

create trigger set_automation_runs_updated_at
  before update on public.automation_runs
  for each row execute function public.set_updated_at();
