-- 0022: owner-only opruimfunctie voor de gemarkeerde zip-flow testfixture.
--
-- AANLEIDING: de interne Project → Requirements → Design Plan → Theme ZIP flow
-- is alleen testbaar met een lead die de lifecycle-guards doorloopt; de guard
-- CONFIRMED_PROSPECT_REPLY_REQUIRED (0012) blokkeert terecht elke lead-status
-- die een bevestigde prospect-reactie vereist. De fixture (lib/testing/
-- project-zip-fixture.ts + app/actions/project-zip-fixture.ts) omzeilt niets:
-- een dubbel gemarkeerde, fictieve lead gaat via de wettige new→qualified-
-- transition het project in. Deze functie is de tegenhanger: het veilige,
-- transactionele opruimen van de volledige fixture-voetafdruk.
--
-- VEILIGHEID:
-- - Alleen uitvoerbaar door de geverifieerde studio-owner (is_studio_owner);
--   service_role/anon hebben GEEN execute-recht.
-- - Verwijdert UITSLUITEND rijen van een lead met BEIDE markeringen:
--   business_name-prefix '[TEST-FIXTURE]' én note-token
--   'TESTFIXTURE-ZIP-FLOW'. Elke andere lead → NOT_A_TEST_FIXTURE.
-- - Bestaande guards (0010/0011/0012/0020) worden NIET gewijzigd: geen
--   enkele gate, lifecycle-regel of permissie verandert.
-- - Circulair gekoppelde rijen (conversations ↔ inbound_messages en
--   leads ↔ inbound/projects) worden opgeruimd met hetzelfde transactionele
--   patroon als de eerdere E2E-cleanups: scope-FK's droppen, fixture-rijen
--   verwijderen, FK's identiek terugzetten (één transactie; rollback bij
--   elke fout laat de database onaangeroerd).

begin;

create function public.remove_zip_flow_test_fixture(p_lead uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  l public.leads;
  project_ids uuid[];
  website_ids uuid[];
  project_texts text[];
  website_texts text[];
begin
  if not public.is_studio_owner() then
    raise exception 'HUMAN_AUTHORIZATION_REQUIRED' using errcode='42501';
  end if;

  select * into l from public.leads where id = p_lead;
  if l.id is null then
    raise exception 'TEST_FIXTURE_NOT_FOUND: lead bestaat niet.' using errcode='P0002';
  end if;
  if not (l.business_name like '[TEST-FIXTURE]%'
          and exists (select 1 from unnest(l.notes) n where n = 'TESTFIXTURE-ZIP-FLOW')) then
    raise exception 'NOT_A_TEST_FIXTURE: verwijderen is alleen mogelijk voor dubbel gemarkeerde fixture-leads.' using errcode='P0001';
  end if;

  project_ids := array(select id from public.projects where lead_id = p_lead);
  website_ids := array(select id from public.generated_websites where lead_id = p_lead);
  project_texts := array(select id::text from public.projects where lead_id = p_lead);
  website_texts := array(select id::text from public.generated_websites where lead_id = p_lead);

  -- ---- 1. Website-voetafdruk (ZIP-artefacten, QC, websites, design plans) --
  delete from public.theme_zip_artifacts where lead_id = p_lead;
  delete from public.quality_controls where lead_id = p_lead;
  delete from public.generated_websites where lead_id = p_lead;
  delete from public.design_plans where lead_id = p_lead;

  -- ---- 2. Financiële voetafdruk ------------------------------------------
  -- payment_events eerst (approval_id → price_approvals), daarna de
  -- circulair gekoppelde price_approval: null-update als owner + delete.
  -- (guard_human_project_fields staat de null-update toe omdat de
  -- geverifieerde owner deze functie aanroept; geen enkele gate verandert.)
  delete from public.payment_events where project_id = any(project_ids);
  update public.projects set price_approval_id = null
    where lead_id = p_lead and price_approval_id is not null;
  delete from public.price_approvals where project_id = any(project_ids);
  delete from public.price_indications where project_id = any(project_ids);

  -- ---- 3. AI-log en audit-events van de fixture ---------------------------
  delete from public.ai_activities where lead_id = p_lead;
  delete from public.ai_runs where lead_id = p_lead;
  delete from public.audit_events
    where (entity_type = 'lead' and entity_id = p_lead::text)
       or (entity_type = 'project' and entity_id = any(project_texts))
       or (entity_type = 'website' and entity_id = any(website_texts));

  -- ---- 4. Gespreks-/evidence-voetafdruk + projecten + lead ----------------
  -- De fixture maakt zelf géén reacties; als de eigenaar er tóch een
  -- handmatige reactie op heeft vastgelegd, bestaan er circulair gekoppelde
  -- rijen (conversations ↔ inbound_messages, leads ↔ inbound_messages,
  -- leads ↔ projects). De vier scope-FK's worden binnen deze transactie
  -- gedropt en identiek teruggezet nadat alle fixture-rijen weg zijn.
  delete from public.sales_interactions where lead_id = p_lead;
  delete from public.outreach_drafts where lead_id = p_lead;

  alter table public.inbound_messages drop constraint if exists inbound_conversation_scope_fk;
  alter table public.conversations drop constraint if exists conversation_real_reply_fk;
  alter table public.leads drop constraint if exists lead_state_evidence_scope_fk;
  alter table public.leads drop constraint if exists lead_state_project_scope_fk;

  delete from public.conversations where lead_id = p_lead;
  delete from public.inbound_messages where lead_id = p_lead;
  delete from public.lead_contacts where lead_id = p_lead;
  delete from public.projects where lead_id = p_lead;
  delete from public.leads where id = p_lead;

  alter table public.inbound_messages
    add constraint inbound_conversation_scope_fk
    foreign key(conversation_id,lead_id,contact_id,channel) references public.conversations(id,lead_id,contact_id,channel);
  alter table public.conversations
    add constraint conversation_real_reply_fk
    foreign key(first_reply_id,lead_id,contact_id,channel,first_reply_confirmed)
    references public.inbound_messages(id,lead_id,contact_id,channel,reply_confirmed);
  alter table public.leads
    add constraint lead_state_evidence_scope_fk
    foreign key(status_evidence_message_id,id) references public.inbound_messages(id,lead_id);
  alter table public.leads
    add constraint lead_state_project_scope_fk
    foreign key(status_project_id,id) references public.projects(id,lead_id);

  return jsonb_build_object(
    'projects', coalesce(cardinality(project_ids), 0),
    'websites', coalesce(cardinality(website_ids), 0),
    'leadRemoved', not exists(select 1 from public.leads where id = p_lead)
  );
end $$;

revoke all on function public.remove_zip_flow_test_fixture(uuid) from public, anon, service_role;
grant execute on function public.remove_zip_flow_test_fixture(uuid) to authenticated;

insert into public.studio_schema_migrations(version) values('0022_zip_flow_test_fixture');

commit;
