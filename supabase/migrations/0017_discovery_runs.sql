-- 0017_discovery_runs.sql — Fase D: Discovery-orchestratie.
-- Persistente registratie van expliciete owner-discovery-opdrachten
-- (masterconfig 1.4/4.2: discovery start uitsluitend op expliciete opdracht
-- van de eigenaar; elke opdracht wordt als command-record vastgelegd met
-- scope, tellingen, samenvatting en fouten).
-- Geen enkele policy of trigger hier start zelf discovery of outreach:
-- de runtime-oproep blijft de expliciete server action (requireStudioOwner).

create table if not exists public.discovery_runs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id),
  command text not null check (length(btrim(command)) between 3 and 500),
  country text not null default 'NL' check (length(btrim(country)) between 2 and 2),
  province text,
  city text,
  industry text,
  query text,
  source text not null check (source in ('mock','google','directory')),
  requested_limit integer not null check (requested_limit between 1 and 200),
  effective_limit integer not null check (effective_limit between 1 and 200),
  status text not null default 'running'
    check (status in ('running','completed','failed')),
  total_found integer,
  created_leads integer,
  duplicates_skipped integer,
  invalid_skipped integer,
  duration_ms integer,
  created_lead_ids uuid[] not null default '{}',
  summary jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb
    check (jsonb_typeof(errors) = 'array'),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table public.discovery_runs is
  'Expliciete owner-discovery-opdrachten: één rij per run, met scope, tellingen, samenvatting en fouten. Alleen de owner-gated server action schrijft (service-role); discovery start nooit automatisch.';

create index if not exists discovery_runs_recent_idx
  on public.discovery_runs (started_at desc, id);

alter table public.discovery_runs enable row level security;

drop policy if exists discovery_runs_owner_read on public.discovery_runs;
create policy discovery_runs_owner_read on public.discovery_runs
  for select to authenticated
  using (public.is_studio_owner());

-- Schrijfrechten uitsluitend server-side (service-role); anon krijgt géén
-- enkele permissie (incl. default TRUNCATE/REFERENCES), authenticated krijgt
-- uitsluitend SELECT zodat de owner-read-policy daadwerkelijk werkt.
revoke all on public.discovery_runs from anon;
revoke all on public.discovery_runs from authenticated;
grant select on public.discovery_runs to authenticated;
grant select, insert, update on public.discovery_runs to service_role;

-- Audit-events: discovery-runs zijn zelf al het command-record; de orchestrator
-- schrijft één audit_events-rij per run (action 'discovery_run'), analoog aan
-- de bestaande audit-conventies.
