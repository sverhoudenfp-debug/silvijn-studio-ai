-- ============================================================
-- 0020_design_plan_requirements_completeness (Fase I.1)
-- ============================================================
-- Doel:
--  1. Interne Design Plans per project (versieged, RLS, nooit klantzichtbaar).
--  2. DETERMINISTISCHE requirements-completeness: requirements_complete kan
--     ALLÉÉN via de owner-RPC set_project_requirements_complete worden gezet;
--     die functie voert de zes blokkerende checks zelf uit in SQL en
--     weigert bij onvoldoende informatie (INSUFFICIENT_REQUIREMENTS).
--  3. Databank-garanties die de app-laag afdwingt worden hier hard gemaakt:
--     - een directe UPDATE requirements_complete false->true wordt geweigerd
--       (REQUIREMENTS_VERIFICATION_REQUIRED) — alleen de RPC zet de
--       transaction-lokale GUC die de update laat passeren;
--     - een wijziging van requirements zet requirements_complete automatisch
--       terug op false (compleetheid vervalt deterministisch bij scope-wijziging).
--
-- SPIEGEL: de zes blokkerende checks in evaluate_project_requirements_complete
-- zijn identiek aan lib/projects/completeness.ts (zelfde keys ):
--   website_type, page_count, design_level, ecommerce_known,
--   copywriting_known, questionnaire_completion.
--
-- De bestaande production gate (project_production_gate, 0010) is ONAANGEROERD:
-- requirements_complete is slechts één van de vereiste voorwaarden naast
-- goedgekeurde scope/prijs, betaalplan en bevestigde betaling.
-- Menselijke gates (prijs/betaling/APPROVED/levering) veranderen niet.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. design_plans — interne, versieged ontwerpplannen per project
-- ------------------------------------------------------------
create table public.design_plans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  version integer not null check (version >= 1),
  status text not null default 'generating'
    check (status in ('generating', 'completed', 'failed')),
  plan jsonb not null default '{}'::jsonb check (jsonb_typeof(plan) = 'object'),
  missing_information text[] not null default '{}',
  validation_errors text[] not null default '{}',
  model text not null default '',
  mode text not null default 'mock' check (mode in ('mock', 'live')),
  generation_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint design_plans_project_version_key unique (project_id, version)
);

create index idx_design_plans_project_id on public.design_plans (project_id);
create index idx_design_plans_lead_id on public.design_plans (lead_id);

alter table public.design_plans enable row level security;

create trigger set_design_plans_updated_at
  before update on public.design_plans
  for each row execute function public.set_updated_at();

-- Zelfde privilegepatroon als questionnaires (0013): anon niets,
-- authenticated alleen lezen (RLS zonder beleid blokkeert de rest),
-- service-role leest en schrijft server-side.
revoke all on public.design_plans from anon;
grant select on public.design_plans to authenticated;
revoke insert, update, delete on public.design_plans from authenticated;
grant select, insert, update on public.design_plans to service_role;

-- ------------------------------------------------------------
-- 2. evaluate_project_requirements_complete — PURE evaluatie (stable)
--    Spiegel van lib/projects/completeness.ts. Verandert niets.
-- ------------------------------------------------------------
create function public.evaluate_project_requirements_complete(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  p public.projects;
  missing text[] := '{}';
  checks jsonb := '[]';
begin
  select * into p from public.projects where id = p_project;
  if p.id is null then raise exception 'PROJECT_NOT_FOUND' using errcode='P0002'; end if;

  -- 1. website_type
  if coalesce(btrim(p.requirements->>'websiteType'), '') = '' then
    missing := array_append(missing, 'website_type');
    checks := checks || jsonb_build_object('key','website_type','passed',false,'detail','websiteType ontbreekt in de requirements');
  else
    checks := checks || jsonb_build_object('key','website_type','passed',true,'detail',p.requirements->>'websiteType');
  end if;

  -- 2. page_count: geheel getal >= 1
  if coalesce(jsonb_typeof(p.requirements->'numberOfPages'), '') <> 'number'
     or (p.requirements->>'numberOfPages')::numeric < 1
     or (p.requirements->>'numberOfPages')::numeric <> floor((p.requirements->>'numberOfPages')::numeric) then
    missing := array_append(missing, 'page_count');
    checks := checks || jsonb_build_object('key','page_count','passed',false,'detail','numberOfPages ontbreekt of is geen geheel getal >= 1');
  else
    checks := checks || jsonb_build_object('key','page_count','passed',true,'detail',p.requirements->>'numberOfPages');
  end if;

  -- 3. design_level
  if coalesce(btrim(p.requirements->>'designLevel'), '') = '' then
    missing := array_append(missing, 'design_level');
    checks := checks || jsonb_build_object('key','design_level','passed',false,'detail','designLevel ontbreekt in de requirements');
  else
    checks := checks || jsonb_build_object('key','design_level','passed',true,'detail',p.requirements->>'designLevel');
  end if;

  -- 4. ecommerce_known (onbekend is niet hetzelfde als nee)
  if coalesce(jsonb_typeof(p.requirements->'ecommerce'), '') <> 'boolean' then
    missing := array_append(missing, 'ecommerce_known');
    checks := checks || jsonb_build_object('key','ecommerce_known','passed',false,'detail','ecommerce ontbreekt in de requirements');
  else
    checks := checks || jsonb_build_object('key','ecommerce_known','passed',true,'detail',(p.requirements->>'ecommerce'));
  end if;

  -- 5. copywriting_known
  if coalesce(jsonb_typeof(p.requirements->'copywriting'), '') <> 'boolean' then
    missing := array_append(missing, 'copywriting_known');
    checks := checks || jsonb_build_object('key','copywriting_known','passed',false,'detail','copywriting ontbreekt in de requirements');
  else
    checks := checks || jsonb_build_object('key','copywriting_known','passed',true,'detail',(p.requirements->>'copywriting'));
  end if;

  -- 6. questionnaire_completion: een ACTIEVE questionnaire die nog niet
  --    QUESTIONNAIRE_COMPLETE is, blokkeert (open, follow-up of aandachtspunt).
  --    Gesloten questionnaires blokkeren niet (eigenaarsbesluit).
  if exists (
    select 1 from public.questionnaires q
    where q.lead_id = p.lead_id
      and q.status = 'active'
      and coalesce(q.completion_status, '') <> 'QUESTIONNAIRE_COMPLETE'
  ) then
    missing := array_append(missing, 'questionnaire_completion');
    checks := checks || jsonb_build_object('key','questionnaire_completion','passed',false,'detail','Actieve questionnaire is nog niet afgerond');
  else
    checks := checks || jsonb_build_object('key','questionnaire_completion','passed',true,'detail','Geen openstaande questionnaire die productie blokkeert');
  end if;

  return jsonb_build_object(
    'complete', not exists (select 1 from unnest(missing) m),
    'missing', to_jsonb(missing),
    'checks', checks
  );
end $$;

revoke all on function public.evaluate_project_requirements_complete(uuid) from public, anon;
grant execute on function public.evaluate_project_requirements_complete(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- 3. set_project_requirements_complete — de ENige weg naar true.
--    Vereist de ingelogde studio-eigenaar (is_studio_owner); herverifieert
--    alle zes checks; zet de GUC die de update-guard laat passeren; auditeert.
-- ------------------------------------------------------------
create function public.set_project_requirements_complete(p_project uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  p public.projects;
  result jsonb;
begin
  if not public.is_studio_owner() then
    raise exception 'HUMAN_AUTHORIZATION_REQUIRED' using errcode='42501';
  end if;

  select * into p from public.projects where id = p_project for update;
  if p.id is null then raise exception 'PROJECT_NOT_FOUND' using errcode='P0002'; end if;

  result := public.evaluate_project_requirements_complete(p_project);
  if not coalesce((result->>'complete')::boolean, false) then
    raise exception 'INSUFFICIENT_REQUIREMENTS: %', result->>'missing' using errcode='P0001';
  end if;

  perform set_config('studio.requirements_verified', 'verified', true);
  update public.projects set requirements_complete = true where id = p.id;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, details)
    values (auth.uid(), 'requirements_marked_complete', 'project', p.id::text,
            jsonb_build_object('checks', result->'checks'));

  return result;
end $$;

revoke all on function public.set_project_requirements_complete(uuid) from public, anon, service_role;
grant execute on function public.set_project_requirements_complete(uuid) to authenticated;

-- ------------------------------------------------------------
-- 4. set_project_requirements_incomplete — expliciete intrekking door de
--    eigenaar (naast de automatische reset bij requirements-wijziging).
-- ------------------------------------------------------------
create function public.set_project_requirements_incomplete(p_project uuid, p_reason text default '')
returns void language plpgsql security definer set search_path='' as $$
declare p public.projects;
begin
  if not public.is_studio_owner() then
    raise exception 'HUMAN_AUTHORIZATION_REQUIRED' using errcode='42501';
  end if;

  select * into p from public.projects where id = p_project for update;
  if p.id is null then raise exception 'PROJECT_NOT_FOUND' using errcode='P0002'; end if;

  update public.projects set requirements_complete = false where id = p.id;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, details)
    values (auth.uid(), 'requirements_marked_incomplete', 'project', p.id::text,
            jsonb_build_object('reason', coalesce(p_reason, '')));
end $$;

revoke all on function public.set_project_requirements_incomplete(uuid, text) from public, anon, service_role;
grant execute on function public.set_project_requirements_incomplete(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 5. update-guard op projects: false->true alléén via de RPC; requirements-
--    wijziging reset compleetheid automatisch.
-- ------------------------------------------------------------
create function public.guard_requirements_complete_transition() returns trigger
language plpgsql set search_path='' as $$
begin
  -- Bewijsvereiste: false->true mag uitsluitend via set_project_requirements_complete,
  -- die de deterministische checks afdwingt en deze GUC zet. Elke andere weg
  -- (inclusief service-role via PostgREST) wordt geweigerd.
  if new.requirements_complete and not old.requirements_complete
     and coalesce(current_setting('studio.requirements_verified', true), '') <> 'verified' then
    raise exception 'REQUIREMENTS_VERIFICATION_REQUIRED' using errcode='42501';
  end if;

  -- Deterministische vervalling: gewijzigde requirements → compleetheid vervalt.
  if new.requirements is distinct from old.requirements then
    new.requirements_complete := false;
  end if;

  return new;
end $$;

create trigger enforce_requirements_complete_guards
  before update on public.projects
  for each row execute function public.guard_requirements_complete_transition();

insert into public.studio_schema_migrations(version) values ('0020_design_plan_requirements_completeness');

commit;
