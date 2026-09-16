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
