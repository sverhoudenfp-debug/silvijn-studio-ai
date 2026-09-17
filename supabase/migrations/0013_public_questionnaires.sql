-- ============================================================
-- Silvijn Studio AI — 0013: publieke questionnaires (host-based)
-- Minimale tabellen voor de publieke questionnaire-flow op
-- questionnaire.silvijnstudio.com/{slug}. RLS aan zonder publiek
-- beleid: alle toegang verloopt uitsluitend server-side via de
-- secret key. Publieke bezoekers kunnen geen enkele rij lezen.
-- ============================================================

begin;

create table public.questionnaires (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  slug text not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  intro text not null default '' check (length(intro) <= 2000),
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array'),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint questionnaires_slug_key unique (slug),
  constraint questionnaires_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 1 and 120)
);

create index idx_questionnaires_lead_id on public.questionnaires (lead_id);
create index idx_questionnaires_status on public.questionnaires (status);

alter table public.questionnaires enable row level security;

create trigger set_questionnaires_updated_at
  before update on public.questionnaires
  for each row execute function public.set_updated_at();

create table public.questionnaire_responses (
  id uuid primary key default gen_random_uuid(),
  questionnaire_id uuid not null references public.questionnaires (id) on delete cascade,
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_questionnaire_responses_questionnaire
  on public.questionnaire_responses (questionnaire_id, submitted_at desc);

alter table public.questionnaire_responses enable row level security;

create trigger set_questionnaire_responses_updated_at
  before update on public.questionnaire_responses
  for each row execute function public.set_updated_at();

-- Server-side garantie (naast de applicatievalidatie): een antwoord kan
-- uitsluitend worden opgeslagen bij een actieve questionnaire.
create function public.guard_questionnaire_response() returns trigger
language plpgsql set search_path='' as $$
declare q public.questionnaires;
begin
  select * into q from public.questionnaires where id = new.questionnaire_id;
  if q.id is null then raise exception 'QUESTIONNAIRE_NOT_FOUND'; end if;
  if q.status <> 'active' then raise exception 'QUESTIONNAIRE_NOT_ACTIVE'; end if;
  return new;
end $$;

create trigger enforce_questionnaire_response
  before insert on public.questionnaire_responses
  for each row execute function public.guard_questionnaire_response();

-- Zelfde privilegepatroon als migratie 0010: authenticated krijgt alleen
-- leesrechten (RLS blokkeert zonder beleid alles), anon niets, en de
-- server-side service-role mag lezen en schrijven.
revoke all on public.questionnaires, public.questionnaire_responses from anon;
grant select on public.questionnaires, public.questionnaire_responses to authenticated;
revoke insert, update, delete on public.questionnaires, public.questionnaire_responses from authenticated;
grant select, insert on public.questionnaires, public.questionnaire_responses to service_role;

insert into public.studio_schema_migrations(version) values ('0013_public_questionnaires');

commit;
