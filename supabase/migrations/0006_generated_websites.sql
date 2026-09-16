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
    check (status in ('generating', 'generated', 'building', 'ready_for_qc', 'failed', 'archived')),
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
