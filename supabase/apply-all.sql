-- ============================================================
-- Silvijn Studio AI — gecombineerde migratie (0001 t/m 0008).
-- EENMALIG in zijn geheel uitvoeren in de Supabase SQL-editor
-- (Dashboard → SQL Editor → New query → plak → Run).
-- Volgorde is belangrijk; dit bestand bevat ze al in de juiste
-- volgorde. Alle tabellen hebben RLS aan zonder publiek beleid:
-- mutaties lopen uitsluitend server-side.
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- supabase/migrations/0001_init.sql
-- ══════════════════════════════════════════════════════════════
-- ============================================================
-- Silvijn Studio AI — Fase 4 database-init
-- Tabellen: leads, demo_websites, ai_activities, ai_runs
--
-- Beveiliging: RLS staat op alle tabellen AAN zonder publiek
-- beleid. Data-toegang verloopt in deze fase uitsluitend
-- server-side via de SUPABASE_SECRET_KEY (bypasses RLS).
-- Authenticatie + publieke policies volgen in de security-fase.
-- ============================================================

-- leads -------------------------------------------------------
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  industry text not null,
  address text,
  postal_code text,
  city text not null,
  province text not null,
  country text not null default 'Nederland',
  phone text,
  email text,
  website text,
  website_status text not null
    check (website_status in ('no_website', 'has_website', 'website_poor', 'unknown')),
  google_rating numeric(2, 1),
  review_count integer check (review_count is null or review_count >= 0),
  lead_score integer not null default 0 check (lead_score between 0 and 100),
  lead_status text not null default 'new'
    check (lead_status in ('new', 'analyzing', 'qualified', 'contacted', 'interested', 'won', 'lost')),
  outreach_status text not null default 'not_contacted'
    check (outreach_status in ('not_contacted', 'draft', 'sent', 'opened', 'replied', 'interested', 'opted_out')),
  demo_status text not null default 'not_created'
    check (demo_status in ('not_created', 'generating', 'ready', 'failed')),
  source text not null
    check (source in ('mock', 'google', 'directory', 'manual', 'referral', 'other')),
  notes text[] not null default '{}',
  ai_summary jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_leads_city on public.leads (city);
create index if not exists idx_leads_lead_status on public.leads (lead_status);
create index if not exists idx_leads_created_at on public.leads (created_at desc);

-- demo_websites ------------------------------------------------
create table if not exists public.demo_websites (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  slug text not null unique,
  business_name text not null,
  industry text not null,
  city text not null,
  template text not null
    check (template in ('local_service', 'professional_service', 'home_improvement', 'business_standard')),
  status text not null
    check (status in ('not_created', 'generating', 'ready', 'failed')),
  generation_status text not null
    check (generation_status in ('idle', 'generating', 'completed', 'failed')),
  headline text not null,
  description text not null,
  services jsonb not null default '[]',
  cta_text text not null,
  notes text not null default '',
  preview_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_demo_websites_lead_id on public.demo_websites (lead_id);
create index if not exists idx_demo_websites_slug on public.demo_websites (slug);

-- ai_activities ------------------------------------------------
create table if not exists public.ai_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads (id) on delete set null,
  type text not null,
  status text not null check (status in ('started', 'completed', 'failed')),
  message text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_activities_lead_id on public.ai_activities (lead_id);
create index if not exists idx_ai_activities_type on public.ai_activities (type);
create index if not exists idx_ai_activities_created_at on public.ai_activities (created_at desc);

-- ai_runs -------------------------------------------------------
create table if not exists public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  agent_type text not null,
  task_type text not null,
  model text not null,
  mode text not null check (mode in ('mock', 'live')),
  status text not null check (status in ('completed', 'failed')),
  lead_id uuid references public.leads (id) on delete set null,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  estimated_cost numeric(12, 8),
  duration_ms integer,
  error_message text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_runs_agent_type on public.ai_runs (agent_type);
create index if not exists idx_ai_runs_created_at on public.ai_runs (created_at desc);

-- updated_at automatisch bijhouden -----------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

create trigger demo_websites_set_updated_at
  before update on public.demo_websites
  for each row execute function public.set_updated_at();

-- Row Level Security: aan, zonder publiek beleid (server-only toegang)
alter table public.leads enable row level security;
alter table public.demo_websites enable row level security;
alter table public.ai_activities enable row level security;
alter table public.ai_runs enable row level security;


-- ══════════════════════════════════════════════════════════════
-- supabase/migrations/0002_lead_discovery_fields.sql
-- ══════════════════════════════════════════════════════════════
-- ============================================================
-- Silvijn Studio AI — Fase 5: discovery-velden op leads
-- Backward-compatible: twee nullable kolommen + partiële unique index.
-- external_id + source_url laten toe dat een kandidaat later als
-- duplicaat van dezelfde bron wordt herkend.
-- ============================================================

alter table public.leads
  add column if not exists external_id text,
  add column if not exists source_url text;

-- Eén lead per externe bron-ID (waar aanwezig)
create unique index if not exists idx_leads_source_external_id
  on public.leads (source, external_id)
  where external_id is not null;


-- ══════════════════════════════════════════════════════════════
-- supabase/migrations/0003_outreach_drafts.sql
-- ══════════════════════════════════════════════════════════════
-- ============================================================
-- Silvijn Studio AI — Fase 6: outreach_drafts
-- Concepten (drafts) voor AI-outreach. RLS aan zonder publiek
-- beleid: toegang verloopt uitsluitend server-side via secret key.
-- "sent" wordt pas in een latere fase met expliciete approval gezet.
-- ============================================================

create table if not exists public.outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  channel text not null default 'email'
    check (channel in ('email', 'linkedin', 'phone', 'other')),
  status text not null default 'draft'
    check (status in ('draft', 'ready_for_review', 'approved', 'sent', 'failed', 'cancelled')),
  subject text not null default '',
  body text not null default '',
  personalization_reason text not null default '',
  call_to_action text not null default '',
  model text not null default '',
  ai_run_id uuid,
  quality_issues text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_outreach_drafts_lead_id
  on public.outreach_drafts (lead_id);

create index if not exists idx_outreach_drafts_status
  on public.outreach_drafts (status);

alter table public.outreach_drafts enable row level security;

create trigger set_outreach_drafts_updated_at
  before update on public.outreach_drafts
  for each row execute function public.set_updated_at();


-- ══════════════════════════════════════════════════════════════
-- supabase/migrations/0004_sales.sql
-- ══════════════════════════════════════════════════════════════
-- ============================================================
-- Silvijn Studio AI — Fase 7: inbound_messages + sales_interactions
-- Inkomende reacties en AI sales-analyses. RLS aan zonder publiek
-- beleid: toegang verloopt uitsluitend server-side via secret key.
-- ============================================================

create table if not exists public.inbound_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  channel text not null default 'email'
    check (channel in ('email', 'linkedin', 'phone', 'other')),
  sender text not null default '',
  subject text not null default '',
  body text not null default '',
  received_at timestamptz not null default now(),
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inbound_messages_lead_id
  on public.inbound_messages (lead_id);

alter table public.inbound_messages enable row level security;

create trigger set_inbound_messages_updated_at
  before update on public.inbound_messages
  for each row execute function public.set_updated_at();

create table if not exists public.sales_interactions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  inbound_message_id uuid not null references public.inbound_messages (id) on delete cascade,
  intent text not null default 'unclear'
    check (intent in ('interested', 'question', 'price_request', 'demo_request',
                      'call_request', 'more_information', 'not_interested',
                      'objection', 'not_now', 'wrong_contact', 'opt_out', 'unclear')),
  objection_type text not null default 'none'
    check (objection_type in ('price_objection', 'timing_objection', 'trust_objection',
                              'need_objection', 'competitor', 'existing_provider',
                              'not_interested', 'unclear', 'none')),
  qualification jsonb not null default '{}'::jsonb,
  response_draft text not null default '',
  suggested_next_action text not null default '',
  questions text[] not null default '{}',
  escalation_required boolean not null default false,
  escalation_reason text,
  status text not null default 'draft'
    check (status in ('draft', 'ready_for_silvijn', 'handled', 'cancelled')),
  quality_issues text[] not null default '{}',
  model text not null default '',
  ai_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sales_interactions_lead_id
  on public.sales_interactions (lead_id);

create index if not exists idx_sales_interactions_status
  on public.sales_interactions (status);

alter table public.sales_interactions enable row level security;

create trigger set_sales_interactions_updated_at
  before update on public.sales_interactions
  for each row execute function public.set_updated_at();


-- ══════════════════════════════════════════════════════════════
-- supabase/migrations/0005_projects_pricing.sql
-- ══════════════════════════════════════════════════════════════
-- ============================================================
-- Silvijn Studio AI — Fase 8: projects + price_indications
-- Projecten uit gekwalificeerde leads; deterministische prijsindicaties
-- met versie-herleidbaarheid. RLS aan zonder publiek beleid:
-- uitsluitend server-side toegang via secret key.
-- ============================================================

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  name text not null,
  status text not null default 'quotation_pending'
    check (status in ('quotation_pending', 'price_ready', 'awaiting_approval',
                      'approved', 'in_progress', 'ready_for_review',
                      'completed', 'cancelled')),
  project_type text,
  description text not null default '',
  requirements jsonb not null default '{}'::jsonb,
  estimated_price numeric(12, 2),
  price_status text not null default 'not_calculated'
    check (price_status in ('not_calculated', 'calculating', 'ready',
                            'missing_information', 'configuration_missing',
                            'requires_human', 'approved', 'rejected')),
  currency text not null default 'EUR',
  timeline text,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_projects_lead_id on public.projects (lead_id);
create index if not exists idx_projects_status on public.projects (status);

alter table public.projects enable row level security;

create trigger set_projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

create table if not exists public.price_indications (
  id text primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  currency text not null default 'EUR',
  pricing_version text not null default '',
  line_items jsonb not null default '[]'::jsonb,
  base_price numeric(12, 2) not null default 0,
  add_ons_total numeric(12, 2) not null default 0,
  adjustments_total numeric(12, 2) not null default 0,
  subtotal numeric(12, 2) not null default 0,
  tax numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  price_range jsonb,
  assumptions text[] not null default '{}',
  missing_information text[] not null default '{}',
  status text not null
    check (status in ('ready', 'missing_information', 'configuration_missing', 'requires_human')),
  requires_human boolean not null default false,
  escalation_reasons text[] not null default '{}',
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_price_indications_project_id
  on public.price_indications (project_id);

alter table public.price_indications enable row level security;


-- ══════════════════════════════════════════════════════════════
-- supabase/migrations/0006_generated_websites.sql
-- ══════════════════════════════════════════════════════════════
-- ============================================================
-- Silvijn Studio AI — Fase 9: generated_websites
-- Gegenereerde klantwebsites per project, met versioning: elke
-- generatie is een nieuw record; oudere versies worden gearchiveerd
-- en blijven terugvindbaar. RLS aan zonder publiek beleid:
-- uitsluitend server-side toegang via secret key.
-- ============================================================

create table if not exists public.generated_websites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  slug text not null unique,
  business_name text not null,
  status text not null default 'generating'
    check (status in ('generating', 'generated', 'building', 'ready_for_qc',
      'qc_running', 'ready_for_silvijn', 'needs_revision', 'approved',
      'failed', 'archived')),
  generation_status text not null default 'pending'
    check (generation_status in ('pending', 'planning', 'generating', 'validating', 'completed', 'failed')),
  website_type text not null
    check (website_type in ('local_service', 'professional_service', 'home_improvement', 'business_standard')),
  framework text not null default 'nextjs' check (framework in ('nextjs', 'shopify')),
  template text not null
    check (template in ('local_service', 'professional_service', 'home_improvement', 'business_standard')),
  specification jsonb not null,
  generated_content jsonb,
  preview_url text not null,
  build_status text not null default 'not_built'
    check (build_status in ('not_built', 'building', 'passed', 'failed')),
  build_errors text[] not null default '{}',
  generation_notes text not null default '',
  version integer not null check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, version)
);

create index if not exists idx_generated_websites_project_id on public.generated_websites (project_id);
create index if not exists idx_generated_websites_lead_id on public.generated_websites (lead_id);
create index if not exists idx_generated_websites_status on public.generated_websites (status);

alter table public.generated_websites enable row level security;

create trigger set_generated_websites_updated_at
  before update on public.generated_websites
  for each row execute function public.set_updated_at();


-- ══════════════════════════════════════════════════════════════
-- supabase/migrations/0007_quality_control.sql
-- ══════════════════════════════════════════════════════════════
-- ============================================================
-- Silvijn Studio AI — Fase 10: quality_controls
-- QC-rapporten per gegenereerde websiteversie. History wordt
-- NOOIT overschreven: elke run is een nieuw record. RLS aan zonder
-- publiek beleid: uitsluitend server-side toegang via secret key;
-- mutaties lopen alléén via server actions (human approval = harde gate).
-- ============================================================

create table if not exists public.quality_controls (
  id uuid primary key default gen_random_uuid(),
  generated_website_id uuid not null references public.generated_websites (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  website_version integer not null check (website_version >= 1),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed')),
  overall_result text not null default 'blocked'
    check (overall_result in ('pass', 'needs_revision', 'fail', 'blocked')),
  checks jsonb not null default '[]',
  issues jsonb not null default '[]',
  warnings text[] not null default '{}',
  passed_checks text[] not null default '{}',
  failed_checks text[] not null default '{}',
  recommendations text[] not null default '{}',
  ai_summary text not null default '',
  score integer not null default 0 check (score >= 0 and score <= 100),
  ai_run_id uuid,
  mode text not null check (mode in ('mock', 'live')),
  model text not null,
  approval jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_quality_controls_website_id on public.quality_controls (generated_website_id);
create index if not exists idx_quality_controls_project_id on public.quality_controls (project_id);
create index if not exists idx_quality_controls_status on public.quality_controls (status);

alter table public.quality_controls enable row level security;

create trigger set_quality_controls_updated_at
  before update on public.quality_controls
  for each row execute function public.set_updated_at();


-- ══════════════════════════════════════════════════════════════
-- supabase/migrations/0008_automation.sql
-- ══════════════════════════════════════════════════════════════
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

