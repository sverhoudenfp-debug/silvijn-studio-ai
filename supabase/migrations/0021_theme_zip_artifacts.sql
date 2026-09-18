-- ============================================================
-- Silvijn Studio AI — Fase I.2: theme_zip_artifacts + privé bucket
-- Additieve migratie: metadata + versiebeheer voor gegenereerde
-- Shopify theme-ZIPs. Elke generatie is een NIEUW record; niets
-- wordt verwijderd (versiegeschiedenis is de bron van waarheid).
-- RLS aan zonder publiek beleid: uitsluitend server-side toegang
-- via de secret key; download uitsluitend via tijdelijke signed
-- URLs die het dashboard server-side genereert.
-- ============================================================

begin;

create table if not exists public.theme_zip_artifacts (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.generated_websites (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  version integer not null check (version >= 1),
  status text not null default 'validating'
    check (status in ('validating', 'passed', 'failed')),
  storage_bucket text,
  storage_path text,
  file_name text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  file_count integer not null check (file_count >= 0),
  checksum_sha256 text not null,
  validation_errors text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (website_id, version)
);

create index if not exists idx_theme_zip_artifacts_website_id on public.theme_zip_artifacts (website_id);
create index if not exists idx_theme_zip_artifacts_project_id on public.theme_zip_artifacts (project_id);
create index if not exists idx_theme_zip_artifacts_lead_id on public.theme_zip_artifacts (lead_id);

alter table public.theme_zip_artifacts enable row level security;

create trigger set_theme_zip_artifacts_updated_at
  before update on public.theme_zip_artifacts
  for each row execute function public.set_updated_at();

-- Geen publieke/anon-toegang; authenticated uitsluitend lezen
-- (dashboard-weergave voor de owner); schrijven alleen server-side.
revoke all on public.theme_zip_artifacts from anon;
grant select on public.theme_zip_artifacts to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.theme_zip_artifacts from authenticated;
grant select, insert, update, delete on public.theme_zip_artifacts to service_role;

-- Privé opslagbucket voor theme-ZIPs: geen publieke toegang; download
-- verloopt uitsluitend server-side via tijdelijke signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'theme-artifacts',
  'theme-artifacts',
  false,
  52428800,
  array['application/zip']
)
on conflict (id) do nothing;

insert into public.studio_schema_migrations(version)
values ('0021_theme_zip_artifacts')
on conflict (version) do nothing;

commit;
