-- ============================================================
-- Automation Runtime (migratie 0016) — live tests met rollback.
-- Synthetische fixtures; niets wordt gepersisteerd.
-- ============================================================
begin;

do $$
declare
  q1 uuid;
  q2 uuid;
  q3 uuid;
  claimed public.automation_queue;
  tmp_q public.automation_queue;
  reclaimed int;
  owner_id uuid;
begin
  -- Fixture-automations (FK op automation_queue; rollback ruimt op).
  insert into public.automations(id, name, description, type, status, enabled, trigger, steps,
                                execution_count, success_count, failure_count, created_at, updated_at)
  values('runtime-fixture-a','RUNTIME FIXTURE A','live test fixture','lead_pipeline','paused',false,'manual','[]'::jsonb,0,0,0,now(),now()),
        ('runtime-fixture-b','RUNTIME FIXTURE B','live test fixture','lead_pipeline','paused',false,'manual','[]'::jsonb,0,0,0,now(),now());

  -- ------------------------------------------------------------
  -- TEST 1: claim_next_automation_queue_item claimt atomair oudste eerst
  -- ------------------------------------------------------------
  insert into public.automation_queue(automation_id, entity_id, entity_type, trigger_event, status, attempts, error)
  values('runtime-fixture-a', null, 'none', 'manual', 'queued', 0, null)
  returning id into q1;
  insert into public.automation_queue(automation_id, entity_id, entity_type, trigger_event, status, attempts, error)
  values('runtime-fixture-b', null, 'none', 'manual', 'queued', 0, null)
  returning id into q2;

  claimed := public.claim_next_automation_queue_item('{}');
  if claimed.id is distinct from q1 then
    raise exception 'TEST 1 FAILED: oudste item niet geclaimd (kreeg %, verwacht %)', claimed.id, q1;
  end if;
  if claimed.status <> 'processing' or claimed.claimed_at is null then
    raise exception 'TEST 1 FAILED: claim zet status/claimed_at verkeerd';
  end if;

  -- ------------------------------------------------------------
  -- TEST 2: al geclaimd item wordt nooit twee keer geclaimd
  -- ------------------------------------------------------------
  tmp_q := public.claim_next_automation_queue_item('{}');
  if tmp_q.id is distinct from q2 then
    raise exception 'TEST 2 FAILED: geclaimd item opnieuw uitgedeeld (%)', tmp_q.id;
  end if;
  tmp_q := public.claim_next_automation_queue_item('{}');
  if tmp_q.id is not null then
    raise exception 'TEST 2 FAILED: queue leeg maar toch item geclaimd';
  end if;

  -- ------------------------------------------------------------
  -- TEST 3: p_exclude houdt herkansde items binnen één drain buiten
  -- (backoff: tijdelijke fout wacht op de volgende cron-run)
  -- ------------------------------------------------------------
  update public.automation_queue set status='queued', claimed_at=null where id = q2;
  tmp_q := public.claim_next_automation_queue_item(array[q2::uuid]);
  if tmp_q.id is not null then
    raise exception 'TEST 3 FAILED: uitgesloten item werd toch geclaimd';
  end if;

  -- ------------------------------------------------------------
  -- TEST 4: reclaim_stale_processing_items wint vastgelopen items terug
  -- ------------------------------------------------------------
  update public.automation_queue
     set status='processing', claimed_at = now() - interval '10 minutes'
   where id = q2;
  reclaimed := public.reclaim_stale_processing_items(now() - interval '5 minutes', 3);
  if reclaimed < 1 then
    raise exception 'TEST 4 FAILED: geen stale item teruggewonnen';
  end if;
  if exists(select 1 from public.automation_queue where id = q2 and (status <> 'queued' or attempts <> 1 or claimed_at is not null)) then
    raise exception 'TEST 4 FAILED: reclaim zet status/attempts/claimed_at verkeerd';
  end if;

  -- ------------------------------------------------------------
  -- TEST 5: max pogingen → definitief faal bij reclaim (geen oneindige loop)
  -- ------------------------------------------------------------
  update public.automation_queue
     set status='processing', attempts=3, claimed_at = now() - interval '10 minutes'
   where id = q2;
  reclaimed := public.reclaim_stale_processing_items(now() - interval '5 minutes', 3);
  if exists(select 1 from public.automation_queue where id = q2 and status <> 'failed') then
    raise exception 'TEST 5 FAILED: item met max pogingen niet definitief gefaald';
  end if;

  -- ------------------------------------------------------------
  -- TEST 6: ongeldige parameters worden luidruchtig geweigerd
  -- ------------------------------------------------------------
  begin
    perform public.reclaim_stale_processing_items(now(), 0);
    raise exception 'TEST 6 FAILED: max_attempts=0 geaccepteerd';
  exception when others then
    if sqlerrm <> 'INVALID_MAX_ATTEMPTS' then raise; end if;
  end;

  -- ------------------------------------------------------------
  -- TEST 7: typed runtime-events zijn beschikbaar (constraint)
  -- ------------------------------------------------------------
  insert into public.automation_events(type, entity_type, entity_id, payload, source)
  values('queue_item_claimed', 'none', null, '{}'::jsonb, 'runtime')
  returning id into q3;
  begin
    insert into public.automation_events(type, entity_type, entity_id, payload, source)
    values('queue_item_made_up', 'none', null, '{}'::jsonb, 'runtime');
    raise exception 'TEST 7 FAILED: onbekend event-type geaccepteerd';
  exception when check_violation then
    null; -- verwacht
  end;

  -- ------------------------------------------------------------
  -- TEST 8: claim/reclaim zijn service-role-only (geen publiek/anon/auth)
  -- ------------------------------------------------------------
  if exists(
    select 1 from information_schema.routine_privileges
     where routine_name = 'claim_next_automation_queue_item'
       and grantee in ('public', 'anon', 'authenticated')
  ) or not exists(
    select 1 from information_schema.routine_privileges
     where routine_name = 'claim_next_automation_queue_item' and grantee = 'service_role'
  ) then
    raise exception 'TEST 8 FAILED: claim-functie heeft verkeerde rechten';
  end if;
  if exists(
    select 1 from information_schema.routine_privileges
     where routine_name = 'reclaim_stale_processing_items'
       and grantee in ('public', 'anon', 'authenticated')
  ) then
    raise exception 'TEST 8 FAILED: reclaim-functie heeft publieke rechten';
  end if;

  raise notice 'ALLE RUNTIME-TESTS GESLAAGD (8/8)';
end $$;

-- Expliciet succesaantekening (rollback maakt alles ongedaan):
select 'ALLE RUNTIME-TESTS GESLAAGD (8/8)' as result;

rollback;
