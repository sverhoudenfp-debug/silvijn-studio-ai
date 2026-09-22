-- Phase 1 only: verified KVK identity staging, never lead qualification/outreach.
-- Additive. Existing lead UUIDs, lifecycle, approvals and rows remain untouched.
begin;

alter table public.leads add column if not exists kvk_number text;
alter table public.leads add column if not exists kvk_establishment_number text;
alter table public.leads add constraint leads_kvk_identity_format check (
  (kvk_number is null or kvk_number ~ '^[0-9]{8}$') and
  (kvk_establishment_number is null or (kvk_establishment_number ~ '^[0-9]{12}$' and kvk_number is not null))
);
create unique index leads_kvk_number_unique on public.leads (kvk_number) where kvk_number is not null;
create unique index leads_kvk_establishment_unique on public.leads (kvk_establishment_number) where kvk_establishment_number is not null;

create table public.verified_discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  kvk_number text not null unique check (kvk_number ~ '^[0-9]{8}$'),
  establishment_number text not null unique check (establishment_number ~ '^[0-9]{12}$'),
  identity jsonb not null check (
    jsonb_typeof(identity) = 'object' and
    identity->>'kind' = 'verified_kvk' and
    identity->>'kvkNumber' = kvk_number and
    identity->>'establishmentNumber' = establishment_number and
    identity->'provenance'->>'source' = 'kvk'
  ),
  first_run_id uuid not null references public.discovery_runs(id),
  created_at timestamptz not null default now()
);
comment on table public.verified_discovery_candidates is 'KVK-verified identity candidates only; NOT qualified leads. No website assessments, Google business fields, scoring or outreach.';

create table public.discovery_identity_references (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references public.verified_discovery_candidates(id),
  lead_id uuid references public.leads(id),
  place_id text not null unique check (length(place_id) between 1 and 512 and place_id ~ '^[A-Za-z0-9_-]+$'),
  kvk_number text not null check (kvk_number ~ '^[0-9]{8}$'),
  establishment_number text not null check (establishment_number ~ '^[0-9]{12}$'),
  run_id uuid not null references public.discovery_runs(id),
  created_at timestamptz not null default now(),
  check (num_nonnulls(candidate_id, lead_id) = 1)
);
comment on table public.discovery_identity_references is 'The sole retained Google value is Place ID. Multiple Google locations may reference one KVK enterprise; establishment ID records the independently verified location.';

alter table public.verified_discovery_candidates enable row level security;
alter table public.discovery_identity_references enable row level security;
revoke all on public.verified_discovery_candidates, public.discovery_identity_references from public, anon, authenticated, service_role;
grant select on public.verified_discovery_candidates, public.discovery_identity_references to authenticated, service_role;
create policy verified_candidates_owner_read on public.verified_discovery_candidates for select to authenticated using (public.is_studio_owner());
create policy identity_references_owner_read on public.discovery_identity_references for select to authenticated using (public.is_studio_owner());

-- All writers acquiring an enterprise identity share this lock, including future
-- promotion to leads. Unique indexes provide the final concurrent-write guard.
create function public.lock_lead_kvk_identity() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.kvk_number is not null then
    perform pg_advisory_xact_lock(hashtextextended('discovery-kvk:' || new.kvk_number, 0));
  end if;
  return new;
end;
$$;
revoke all on function public.lock_lead_kvk_identity() from public, anon, authenticated;
create trigger leads_kvk_identity_lock before insert or update of kvk_number on public.leads
  for each row execute function public.lock_lead_kvk_identity();

create function public.persist_verified_discovery_candidate(p_identity jsonb, p_place_id text, p_run_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_kvk text := p_identity->>'kvkNumber';
  v_est text := p_identity->>'establishmentNumber';
  v_candidate uuid;
  v_lead uuid;
  v_status text;
  v_ref record;
  v_key text;
  v_item jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'DISCOVERY_SERVICE_REQUIRED';
  end if;
  if p_identity is null or jsonb_typeof(p_identity) <> 'object'
     or coalesce(v_kvk, '') !~ '^[0-9]{8}$' or coalesce(v_est, '') !~ '^[0-9]{12}$'
     or length(coalesce(p_place_id, '')) not between 1 and 512 or coalesce(p_place_id, '') !~ '^[A-Za-z0-9_-]+$'
     or p_identity->>'kind' is distinct from 'verified_kvk'
     or p_identity->'provenance'->>'source' is distinct from 'kvk'
     or p_identity->'provenance'->>'matchRule' is distinct from 'active_trade_name_and_visit_address_v1'
     or p_identity->'provenance'->>'basisProfile' is distinct from 'https://api.kvk.nl/api/v1/basisprofielen/' || v_kvk
     or p_identity->'provenance'->>'establishmentProfile' is distinct from 'https://api.kvk.nl/api/v1/vestigingsprofielen/' || v_est
     or coalesce(length(btrim(p_identity->>'businessName')),0) = 0
     or p_identity->'address'->>'country' is distinct from 'NL'
  then raise exception 'INVALID_VERIFIED_IDENTITY'; end if;
  for v_key in select jsonb_object_keys(p_identity) loop
    if v_key not in ('kind','kvkNumber','establishmentNumber','businessName','tradeNames','address','activities','websites','nonMailing','legalForm','provenance') then
      raise exception 'INVALID_VERIFIED_IDENTITY';
    end if;
  end loop;
  -- Defense in depth: no untyped JSON pocket for Google payloads.
  if not (p_identity ?& array['kind','kvkNumber','establishmentNumber','businessName','tradeNames','address','activities','websites','nonMailing','legalForm','provenance'])
     or jsonb_typeof(p_identity->'address') is distinct from 'object'
     or jsonb_typeof(p_identity->'provenance') is distinct from 'object'
     or jsonb_typeof(p_identity->'tradeNames') is distinct from 'array'
     or jsonb_typeof(p_identity->'activities') is distinct from 'array'
     or jsonb_typeof(p_identity->'websites') is distinct from 'array'
     or jsonb_typeof(p_identity->'nonMailing') not in ('boolean','null')
     or jsonb_typeof(p_identity->'legalForm') not in ('string','null')
     or coalesce(p_identity->'address'->>'postalCode','') !~ '^[1-9][0-9]{3}[A-Z]{2}$'
     or coalesce(p_identity->'address'->>'houseNumber','') !~ '^[0-9]+$'
     or coalesce(length(p_identity->'address'->>'street'),0) = 0
     or coalesce(length(p_identity->'address'->>'city'),0) = 0
     or coalesce(p_identity->'provenance'->>'fetchedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
  then raise exception 'INVALID_VERIFIED_IDENTITY'; end if;
  for v_key in select jsonb_object_keys(p_identity->'address') loop
    if v_key not in ('street','houseNumber','addition','postalCode','city','country') then raise exception 'INVALID_VERIFIED_IDENTITY'; end if;
  end loop;
  for v_key in select jsonb_object_keys(p_identity->'provenance') loop
    if v_key not in ('source','fetchedAt','basisProfile','establishmentProfile','matchRule') then raise exception 'INVALID_VERIFIED_IDENTITY'; end if;
  end loop;
  if jsonb_array_length(p_identity->'tradeNames') = 0 then raise exception 'INVALID_VERIFIED_IDENTITY'; end if;
  for v_item in select value from jsonb_array_elements(p_identity->'tradeNames') union all select value from jsonb_array_elements(p_identity->'websites') loop
    if jsonb_typeof(v_item) <> 'string' then raise exception 'INVALID_VERIFIED_IDENTITY'; end if;
  end loop;
  for v_item in select value from jsonb_array_elements(p_identity->'activities') loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'INVALID_VERIFIED_IDENTITY'; end if;
    for v_key in select jsonb_object_keys(v_item) loop
      if v_key not in ('code','description','isMain') then raise exception 'INVALID_VERIFIED_IDENTITY'; end if;
    end loop;
    if coalesce(v_item->>'code','') !~ '^[0-9]{2,6}$' or jsonb_typeof(v_item->'description') is distinct from 'string'
       or jsonb_typeof(v_item->'isMain') is distinct from 'boolean' then raise exception 'INVALID_VERIFIED_IDENTITY'; end if;
  end loop;
  if not exists (select 1 from public.discovery_runs where id = p_run_id and source = 'google' and status = 'running') then
    raise exception 'RUN_NOT_ACTIVE_GOOGLE_DISCOVERY';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('discovery-kvk:' || v_kvk, 0));
  perform pg_advisory_xact_lock(hashtextextended('discovery-place:' || p_place_id, 0));
  select * into v_ref from public.discovery_identity_references where place_id = p_place_id;
  if found and (v_ref.kvk_number <> v_kvk or v_ref.establishment_number <> v_est) then
    raise exception 'DISCOVERY_IDENTITY_CONFLICT';
  end if;
  if exists (select 1 from public.leads where kvk_establishment_number = v_est and kvk_number <> v_kvk)
    or exists (select 1 from public.verified_discovery_candidates where establishment_number = v_est and kvk_number <> v_kvk)
    or exists (select 1 from public.discovery_identity_references where establishment_number = v_est and kvk_number <> v_kvk)
  then raise exception 'DISCOVERY_IDENTITY_CONFLICT'; end if;
  select id into v_lead from public.leads where kvk_number = v_kvk;
  if v_lead is not null then
    v_status := 'duplicate_lead';
  else
    select id into v_candidate from public.verified_discovery_candidates where kvk_number = v_kvk;
    if v_candidate is not null then
      v_status := 'duplicate_candidate';
    else
      insert into public.verified_discovery_candidates(kvk_number, establishment_number, identity, first_run_id)
      values (v_kvk, v_est, p_identity, p_run_id) returning id into v_candidate;
      v_status := 'created';
    end if;
  end if;
  insert into public.discovery_identity_references(candidate_id,lead_id,place_id,kvk_number,establishment_number,run_id)
    values(v_candidate,v_lead,p_place_id,v_kvk,v_est,p_run_id) on conflict(place_id) do nothing;
  return jsonb_build_object('status',v_status,'candidateId',v_candidate,'leadId',v_lead);
end;
$$;
revoke all on function public.persist_verified_discovery_candidate(jsonb,text,uuid) from public, anon, authenticated;
grant execute on function public.persist_verified_discovery_candidate(jsonb,text,uuid) to service_role;
commit;
