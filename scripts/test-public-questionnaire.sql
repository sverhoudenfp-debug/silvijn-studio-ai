-- ============================================================
-- Publieke questionnaire-flow (migratie 0013) — live tests met rollback.
-- Synthetische fixtures; niets wordt persist opgeslagen.
-- ============================================================
begin;

do $$
declare
  l uuid;
  q_active uuid;
  q_draft uuid;
  q_closed uuid;
begin
  -- Fixture-lead (synthetisch, duidelijk gelabeld)
  insert into public.leads(business_name, industry, city, province, website_status, source)
  values('PUBLIC QUESTIONNAIRE FIXTURE','test','test','test','no_website','manual')
  returning id into l;

  insert into public.questionnaires(lead_id, slug, title, intro, questions, status)
  values(l,'public-questionnaire-fixture','Fixture vragenlijst','Intro',
         '[{"id":"q1","label":"Wat is je naam?","type":"text","required":true},
           {"id":"q2","label":"E-mail","type":"email","required":false},
           {"id":"q3","label":"Voorkeur","type":"select","options":["Optie A","Optie B"],"required":true}]'::jsonb,
         'active')
  returning id into q_active;

  insert into public.questionnaires(lead_id, slug, title, questions, status)
  values(l,'fixture-draft','Draft','[{"id":"q1","label":"Vraag","type":"text"}]'::jsonb,'draft')
  returning id into q_draft;

  insert into public.questionnaires(lead_id, slug, title, questions, status)
  values(l,'fixture-closed','Closed','[{"id":"q1","label":"Vraag","type":"text"}]'::jsonb,'closed')
  returning id into q_closed;

  -- Ongeldige slug-formaat wordt geweigerd
  begin
    insert into public.questionnaires(lead_id, slug, title, questions) values(l,'Ongeldige_slug!','X','[]'::jsonb);
    raise exception 'TEST: invalid slug accepted';
  exception when check_violation then null;
  end;

  -- Slug is uniek
  begin
    insert into public.questionnaires(lead_id, slug, title, questions) values(l,'public-questionnaire-fixture','X','[]'::jsonb);
    raise exception 'TEST: duplicate slug accepted';
  exception when unique_violation then null;
  end;

  -- Antwoord op actieve questionnaire kan opgeslagen worden (server-side)
  insert into public.questionnaire_responses(questionnaire_id, answers)
  values(q_active, '{"q1":"Voorbeeld naam","q3":"Optie A"}'::jsonb);

  if (select count(*) from public.questionnaire_responses where questionnaire_id=q_active) <> 1 then
    raise exception 'TEST: response not stored';
  end if;

  -- Draft/closed accepteren geen antwoorden (database-garantie)
  begin
    insert into public.questionnaire_responses(questionnaire_id, answers) values(q_draft,'{"q1":"x"}'::jsonb);
    raise exception 'TEST: draft accepted response';
  exception when raise_exception then
    if sqlerrm <> 'QUESTIONNAIRE_NOT_ACTIVE' then raise; end if;
  end;
  begin
    insert into public.questionnaire_responses(questionnaire_id, answers) values(q_closed,'{"q1":"x"}'::jsonb);
    raise exception 'TEST: closed accepted response';
  exception when raise_exception then
    if sqlerrm <> 'QUESTIONNAIRE_NOT_ACTIVE' then raise; end if;
  end;

  -- Antwoorden moeten een JSON-object zijn
  begin
    insert into public.questionnaire_responses(questionnaire_id, answers) values(q_active,'[]'::jsonb);
    raise exception 'TEST: array answers accepted';
  exception when check_violation then null;
  end;

  -- anon: geen lees- of schrijftoegang (RLS + privileges)
  execute 'set local role anon';
  if has_table_privilege('anon','public.questionnaires','SELECT') or has_table_privilege('anon','public.questionnaire_responses','SELECT') then
    raise exception 'TEST: anon has table privileges';
  end if;
  begin
    if exists(select 1 from public.questionnaires) or exists(select 1 from public.questionnaire_responses) then
      raise exception 'TEST: anon read questionnaires';
    end if;
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.questionnaire_responses(questionnaire_id, answers) values(q_active,'{"q1":"forge"}'::jsonb);
    raise exception 'TEST: anon wrote response';
  exception when insufficient_privilege then null;
  end;

  -- authenticated: leesrecht via grant, maar RLS zonder beleid blokkeert alles
  execute 'set local role authenticated';
  if exists(select 1 from public.questionnaires) or exists(select 1 from public.questionnaire_responses) then
    raise exception 'TEST: authenticated bypassed RLS';
  end if;
  begin
    insert into public.questionnaire_responses(questionnaire_id, answers) values(q_active,'{"q1":"forge"}'::jsonb);
    raise exception 'TEST: authenticated wrote response';
  exception when insufficient_privilege then null;
  end;

  -- service-role (server-side flow) kan antwoorden opslaan
  execute 'set local role service_role';
  insert into public.questionnaire_responses(questionnaire_id, answers) values(q_active,'{"q1":"Service flow"}'::jsonb);
  if (select count(*) from public.questionnaire_responses where questionnaire_id=q_active) <> 2 then
    raise exception 'TEST: service_role insert failed';
  end if;
  execute 'reset role';
end $$;

-- Migratievoering vastgelegd
do $$
begin
  if not exists(select 1 from public.studio_schema_migrations where version='0013_public_questionnaires') then
    raise exception 'TEST: migration not registered';
  end if;
end $$;

rollback;

select 'PASS: public questionnaire storage — active/draft/closed gating, slug format/uniqueness, jsonb checks, anon denied (RLS + privileges), authenticated denied by RLS, service_role writes only. Fixtures rolled back.' result;
