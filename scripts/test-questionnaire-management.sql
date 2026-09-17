-- ============================================================
-- Questionnaire-management (migratie 0013 + 0014) — live tests met rollback.
-- Synthetische fixtures; niets wordt persist opgeslagen.
-- ============================================================
begin;

do $$
declare
  l uuid;
  q uuid;
begin
  -- Fixture-lead (synthetisch, duidelijk gelabeld)
  insert into public.leads(business_name, industry, city, province, website_status, source)
  values('QUESTIONNAIRE MANAGEMENT FIXTURE','test','test','test','no_website','manual')
  returning id into l;

  -- Aanmaken: draft met AI-context
  insert into public.questionnaires(lead_id, slug, title, intro, questions, status, ai_context)
  values(l,'qmgmt-fixture','Fixture','Intro',
         '[{"id":"q1","label":"Doel","type":"select","options":["A","B"],"required":true},
           {"id":"q2","label":"Upload","type":"upload"}]'::jsonb,
         'draft',
         '{"sources":["lead"],"generatedAt":"2026-09-17T00:00:00Z"}'::jsonb)
  returning id into q;

  -- Publiceren: applicatie zet published_at + status (repository-contract)
  update public.questionnaires set status='active', published_at=now() where id=q;
  if (select published_at is null from public.questionnaires where id=q) then
    raise exception 'TEST: published_at not stored';
  end if;

  -- Onbekende completion_status wordt geweigerd
  begin
    update public.questionnaires set completion_status='WEIRD_STATUS' where id=q;
    raise exception 'TEST: invalid completion_status accepted';
  exception when check_violation then null;
  end;

  -- Ongeldige completion_analysis (array) wordt geweigerd
  begin
    update public.questionnaires set completion_analysis='[1,2]'::jsonb where id=q;
    raise exception 'TEST: invalid completion_analysis accepted';
  exception when check_violation then null;
  end;

  -- Follow-upvragen (ronde 2): max 3, array-verplicht
  update public.questionnaires
    set completion_status='QUESTIONNAIRE_FOLLOW_UP',
        follow_up_questions='[{"id":"f1","label":"Aanvulling","type":"text","required":true}]'::jsonb
    where id=q;
  if (select jsonb_array_length(follow_up_questions)<>1 from public.questionnaires where id=q) then
    raise exception 'TEST: follow_up_questions not saved';
  end if;

  -- Ronde 1 respons zonder uploads
  insert into public.questionnaire_responses(questionnaire_id, answers, round)
  values(q, '{"q1":"A"}'::jsonb, 1);

  -- Ongeldige ronde (3) wordt geweigerd
  begin
    insert into public.questionnaire_responses(questionnaire_id, answers, round) values(q,'{}'::jsonb,3);
    raise exception 'TEST: invalid round accepted';
  exception when check_violation then null;
  end;

  -- Ronde 2 respons met privé-uploadmetadata
  insert into public.questionnaire_responses(questionnaire_id, answers, uploads, round)
  values(q, '{"f1":"antwoord"}'::jsonb,
         '[{"questionId":"q2","filename":"brief.pdf","path":"%s/%s/q2/x.pdf","size":100,"mimeType":"application/pdf","uploadedAt":"2026-09-17T00:00:00Z"}]'::jsonb,
         2);

  -- Uploads: geen objecten toegestaan
  begin
    update public.questionnaire_responses set uploads='{"a":1}'::jsonb where questionnaire_id=q and round=2;
    raise exception 'TEST: non-array uploads accepted';
  exception when check_violation then null;
  end;

  -- Nieuwe AI-context bij hergeneratie blijft een object
  update public.questionnaires set ai_context='{"sources":["lead","project"]}'::jsonb where id=q;

  -- Sluiten: closed_at wordt gezet
  update public.questionnaires set status='closed', closed_at=now() where id=q;

  -- Relatie-integriteit: questionnaire blijft aan de lead gekoppeld
  if (select lead_id from public.questionnaires where id=q)<>l then
    raise exception 'TEST: lead relation broken';
  end if;

  raise notice 'QMGMT: alle questionnaire-management databasetests geslaagd';
end $$;

-- RLS: outsider (authenticated, non-member) ziet geen questionnaires/responses
insert into auth.users(id,email,email_confirmed_at) values
 ('d29c4450-0000-4000-8000-0000000000f1','qmgmt-fixture@example.invalid',now());
select set_config('request.jwt.claims','{"sub":"d29c4450-0000-4000-8000-0000000000f1","role":"authenticated","email":"qmgmt-fixture@example.invalid"}',true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.questionnaires)<>0 then raise exception 'TEST: outsider read questionnaires'; end if;
  if (select count(*) from public.questionnaire_responses)<>0 then raise exception 'TEST: outsider read responses'; end if;
  begin
    insert into public.questionnaire_responses(questionnaire_id, answers) values(gen_random_uuid(),'{}'::jsonb);
    raise exception 'TEST: outsider wrote response';
  exception when foreign_key_violation then
    raise exception 'TEST: outsider write reached data (fk violation means insert attempted)';
  when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims','',true);

rollback;
