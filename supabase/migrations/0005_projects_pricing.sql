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
