-- ============================================================
-- 0023_content_plans (C3a — Content Intelligence)
-- ============================================================
-- Doel: interne ContentPlans per project — per blueprint-sectie
-- gestructureerde content-units met herkomst, gekoppeld aan ÉÉN
-- specifieke Design Plan-versie (design_plan_id) met eigen
-- versienummering per design plan. De content-pass (C3b+) vult dit
-- artefact; de bestaande websitegeneratie consumeert het pas in C3d
-- (zonder ContentPlan blijft huidig gedrag 100% ongewijzigd).
--
-- SPIEGEL van lib/websites/content/content-plan.ts:
-- - status: draft | completed | failed (fail-loud, geen half plan)
-- - source_fingerprint: verandert zodra brondata verandert; her-
--   generatie detecteert zo drift sinds de laatste pass.
-- - unique (design_plan_id, version): één versierij per design-plan-
--   versie; content her-generéért zonder de architectuur aan te raken.
--
-- PRIVILEGEPATROON — identiek aan design_plans (0020) en
-- theme_zip_artifacts (0021): anon niets (RLS zonder beleid blokkeert
-- alles), authenticated alleen lezen, service-role leest en schrijft
-- server-side. Klant-NOOIT zichtbaar; géén menselijke gates gewijzigd.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. content_plans — interne, versieged content-plannen per project
-- ------------------------------------------------------------
create table public.content_plans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  design_plan_id uuid not null references public.design_plans (id) on delete cascade,
  version integer not null check (version >= 1),
  status text not null default 'draft'
    check (status in ('draft', 'completed', 'failed')),
  mode text not null default 'mock' check (mode in ('mock', 'live')),
  model text not null default '',
  source_fingerprint text not null default '',
  plan jsonb not null default '{}'::jsonb check (jsonb_typeof(plan) = 'object'),
  missing_information text[] not null default '{}',
  validation_errors text[] not null default '{}',
  generation_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_plans_design_plan_version_key unique (design_plan_id, version)
);

create index idx_content_plans_project_id on public.content_plans (project_id);
create index idx_content_plans_lead_id on public.content_plans (lead_id);
create index idx_content_plans_design_plan_id on public.content_plans (design_plan_id);

alter table public.content_plans enable row level security;

create trigger set_content_plans_updated_at
  before update on public.content_plans
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 2. Privileges (spiegel 0020/0021)
-- ------------------------------------------------------------
revoke all on public.content_plans from anon;
grant select on public.content_plans to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.content_plans from authenticated;
grant select, insert, update, delete on public.content_plans to service_role;

-- ------------------------------------------------------------
-- 3. Registratie
-- ------------------------------------------------------------
insert into public.studio_schema_migrations(version)
values ('0023_content_plans')
on conflict (version) do nothing;

commit;
