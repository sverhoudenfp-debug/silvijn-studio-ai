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
