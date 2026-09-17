-- ============================================================
-- Silvijn Studio AI — 0014: questionnaire-management (dashboard)
-- Breidt 0013 uit tot end-to-end bruikbare flow: lifecycle-velden,
-- completion-analyse, follow-upvragen, uploads en privé storage-bucket.
-- RLS blijft aan zonder publiek beleid; toegang verloopt uitsluitend
-- server-side via de secret key.
-- ============================================================

begin;

alter table public.questionnaires
  add column published_at timestamptz,
  add column closed_at timestamptz,
  add column completion_status text
    check (completion_status in ('QUESTIONNAIRE_FOLLOW_UP', 'QUESTIONNAIRE_COMPLETE', 'QUESTIONNAIRE_ATTENTION')),
  add column completion_analysis jsonb not null default '{}'::jsonb
    check (jsonb_typeof(completion_analysis) = 'object'),
  add column follow_up_questions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(follow_up_questions) = 'array'),
  -- Interne AI-contextsnapshot (nooit publiek zichtbaar): welke bronnen
  -- bij het genereren van de vragen zijn gebruikt.
  add column ai_context jsonb not null default '{}'::jsonb
    check (jsonb_typeof(ai_context) = 'object');

create index if not exists idx_questionnaires_project_id on public.questionnaires (project_id);
create index if not exists idx_questionnaires_completion on public.questionnaires (completion_status);

alter table public.questionnaire_responses
  add column uploads jsonb not null default '[]'::jsonb
    check (jsonb_typeof(uploads) = 'array'),
  add column round integer not null default 1
    check (round in (1, 2));

-- Publieke klantuploads: privé bucket (geen publieke toegang).
-- Download verloopt uitsluitend server-side via tijdelijke signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'questionnaire-uploads',
  'questionnaire-uploads',
  false,
  10485760,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

insert into public.studio_schema_migrations(version) values ('0014_questionnaire_management');

commit;
