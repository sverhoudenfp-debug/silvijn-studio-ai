-- ============================================================
-- Gmail-integratie (migratie 0015) — live tests met rollback.
-- Synthetische fixtures; niets wordt gepersisteerd.
-- ============================================================
begin;

do $$
declare
  l1 uuid;
  l2 uuid;
  cid uuid;
  mid1 uuid;
  mid2 uuid;
  owner_id uuid;
  contact_count int;
  conv_count int;
  contact_fixture uuid;
begin
  -- Fixture: het eigenaarsaccount binnen deze transactie als bevestigd
  -- behandelen (rollback maakt dit ongedaan; niets persist).
  update auth.users u set email_confirmed_at = coalesce(u.email_confirmed_at, now())
    from public.studio_members m
   where lower(u.email) = lower(m.email) and m.role = 'owner' and m.enabled;

  -- Fixture: geautoriseerde Gmail-verbinding van de eigenaar (synthetisch,
  -- bestaat alleen binnen deze transactie; rollback maakt alles ongedaan).
  insert into public.gmail_connections(account_key, owner_user_id, token_ciphertext, scopes)
  select 'silvijn@silvijnstudio.com', u.id, 'fixture-ciphertext', 'gmail.send gmail.readonly'
    from auth.users u
    join public.studio_members m on lower(m.email) = lower(u.email) and m.role = 'owner' and m.enabled
   where u.email_confirmed_at is not null
   limit 1;
  if not exists(select 1 from public.gmail_connections where account_key='silvijn@silvijnstudio.com') then
    raise exception 'FIXTURE: geen bevestigd eigenaarsaccount voor gmail-verbinding';
  end if;

  -- Fixture-leads (synthetisch, duidelijk gelabeld)
  insert into public.leads(business_name, industry, city, province, website_status, source, email)
  values('GMAIL FIXTURE A','test','test','test','no_website','manual','fixture-a@example.nl')
  returning id into l1;
  insert into public.leads(business_name, industry, city, province, website_status, source, email)
  values('GMAIL FIXTURE B','test','test','test','no_website','manual','fixture-b@example.nl')
  returning id into l2;

  -- ------------------------------------------------------------
  -- TEST 1: ingest zonder provider-bewijs wordt geweigerd
  -- ------------------------------------------------------------
  begin
    perform public.ingest_gmail_reply(l1,'klant@example.nl','Re: Website','Ik antwoord',now(),null,'silvijn@silvijnstudio.com',null,null,null);
    raise exception 'TEST 1 FAILED: ingest zonder provider-evidence geaccepteerd';
  exception when others then
    if sqlerrm <> 'PROVIDER_EVIDENCE_REQUIRED' then raise; end if;
  end;

  -- ------------------------------------------------------------
  -- TEST 2: reactie van het eigen account wordt genegeerd
  -- ------------------------------------------------------------
  begin
    perform public.ingest_gmail_reply(l1,'silvijn@silvijnstudio.com','Re:','ok',now(),'gm-id-x','silvijn@silvijnstudio.com',null,null,null);
    raise exception 'TEST 2 FAILED: self-reply geaccepteerd';
  exception when others then
    if sqlerrm <> 'SELF_REPLY_IGNORED' then raise; end if;
  end;

  -- ------------------------------------------------------------
  -- TEST 3: echte reactie wordt vastgelegd met source='gmail',
  -- conversation geactiveerd (alléén op genuine reply)
  -- ------------------------------------------------------------
  mid1 := public.ingest_gmail_reply(l1,'klant@example.nl','Re: Website voor uw bedrijf','Ik heb interesse, bel me.',now() - interval '10 minutes','gm-0001','silvijn@silvijnstudio.com','gmail:thread-1',null,null);
  if mid1 is null then raise exception 'TEST 3 FAILED: geen id'; end if;
  if not exists(select 1 from public.inbound_messages where id=mid1 and lead_id=l1 and source='gmail' and reply_confirmed and provider_message_id='gm-0001' and provider_account_key='silvijn@silvijnstudio.com') then
    raise exception 'TEST 3 FAILED: record zonder gmail-evidence';
  end if;
  if not exists(select 1 from public.conversations where lead_id=l1 and first_reply_id=mid1) then
    raise exception 'TEST 3 FAILED: conversation niet geactiveerd door echte reactie';
  end if;
  select count(*) into contact_count from public.lead_contacts where lead_id=l1 and channel='email' and address='klant@example.nl';
  if contact_count <> 1 then raise exception 'TEST 3 FAILED: contact niet opgevoerd'; end if;

  -- confirmed_by is het eigenaarsaccount (NO_VERIFIED_OWNER_ACCOUNT zou
  -- betekenen dat er geen bevestigd eigenaarsaccount bestaat).
  select confirmed_by into owner_id from public.inbound_messages where id=mid1;
  if owner_id is null then raise exception 'TEST 3 FAILED: confirmed_by ontbreekt'; end if;

  -- ------------------------------------------------------------
  -- TEST 4: idempotentie — hetzelfde Gmail-bericht-ID maakt geen
  -- tweede record en geen tweede conversation
  -- ------------------------------------------------------------
  mid2 := public.ingest_gmail_reply(l1,'klant@example.nl','Re: Website voor uw bedrijf','Ik heb interesse, bel me.',now() - interval '10 minutes','gm-0001','silvijn@silvijnstudio.com','gmail:thread-1',null,null);
  if mid2 is distinct from mid1 then raise exception 'TEST 4 FAILED: tweede record voor hetzelfde bericht'; end if;
  select count(*) into conv_count from public.conversations where lead_id=l1;
  if conv_count <> 1 then raise exception 'TEST 4 FAILED: meer dan 1 conversation'; end if;
  select count(*) into conv_count from public.inbound_messages where lead_id=l1 and channel='email' and provider_message_id='gm-0001';
  if conv_count <> 1 then raise exception 'TEST 4 FAILED: meer dan 1 inbound record'; end if;

  -- ------------------------------------------------------------
  -- TEST 5: zelfde bericht-ID op andere lead → conflict (provider
  -- kan één bericht niet aan twee leads toewijzen)
  -- ------------------------------------------------------------
  begin
    perform public.ingest_gmail_reply(l2,'klant@example.nl','Re:','anders',now() - interval '9 minutes','gm-0001','silvijn@silvijnstudio.com',null,null,null);
    raise exception 'TEST 5 FAILED: bericht aan tweede lead toegekend';
  exception when others then
    if sqlerrm <> 'PROVIDER_MESSAGE_CONFLICT' then raise; end if;
  end;

  -- ------------------------------------------------------------
  -- TEST 6: verbonden outreach (sent met provider-bewijs) maakt
  -- GEEN conversation — cold outreach blijft zonder reactie "geen
  -- gesprek" (kernregel masterconfig).
  -- ------------------------------------------------------------
  -- Contact vóór de outreach: de composite FK inbound_reply_outreach_fk
  -- vereist dat de reply exact op (outreach, lead, contact, channel) matcht.
  insert into public.lead_contacts(lead_id, channel, address) values(l2,'email','klant2@example.nl')
  returning id into contact_fixture;

  insert into public.outreach_drafts(lead_id,contact_id,channel,status,subject,body,provider_message_id,provider_account_key,sent_at)
  values(l2,contact_fixture,'email','sent','Website voor uw bedrijf','Beste, ...','<outreach-fixture@silvijnstudio.com>','silvijn@silvijnstudio.com',now() - interval '1 day')
  returning id into cid;
  select count(*) into conv_count from public.conversations where lead_id=l2;
  if conv_count <> 0 then raise exception 'TEST 6 FAILED: outreach alleen creëert conversation'; end if;

  -- Reply op die outreach (In-Reply-To-match) → conversation voor l2.
  mid2 := public.ingest_gmail_reply(l2,'klant2@example.nl','Re: Website voor uw bedrijf','Graag meer info.',now() - interval '5 minutes','gm-0002','silvijn@silvijnstudio.com','gmail:thread-2',cid,null);
  if not exists(select 1 from public.conversations where lead_id=l2 and first_reply_id=mid2) then
    raise exception 'TEST 6 FAILED: reply-op-outreach activeert geen conversation';
  end if;

  -- ------------------------------------------------------------
  -- TEST 7: synthetische source kan nooit een conversation activeren
  -- (bestaande guard blijft intact na 0015)
  -- ------------------------------------------------------------
  begin
    insert into public.inbound_messages(lead_id,channel,sender,subject,body,received_at,source,reply_confirmed)
    values(l2,'email','fake@example.nl','x','y',now(),'mock',true);
    raise exception 'TEST 7 FAILED: mock-activering geaccepteerd';
  exception when others then
    if sqlerrm <> 'SYNTHETIC_REPLY_CANNOT_ACTIVATE_CONVERSATION' then raise; end if;
  end;

  -- ------------------------------------------------------------
  -- TEST 8: gmail_connections — anoniem ziet niets (RLS)
  -- ------------------------------------------------------------
  -- (RLS-check als postgres: policies gelden niet voor tabelowner,
  --  vandaar een grant-claim-check in plaats van select als role.)
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gmail_connections' and policyname='gmail_connection_owner_read') then
    raise exception 'TEST 8 FAILED: owner-read-policy ontbreekt';
  end if;
  if exists(select 1 from pg_tables where schemaname='public' and tablename='gmail_connections' and rowsecurity=false) then
    raise exception 'TEST 8 FAILED: RLS staat niet aan';
  end if;

  raise notice 'ALLE GMAIL-TESTS GESLAAGD (8/8)';
end $$;

rollback;
