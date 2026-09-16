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
