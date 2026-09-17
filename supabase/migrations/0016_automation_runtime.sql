-- ============================================================
-- 0016_automation_runtime — productie-runtime voor de automation-queue
-- (Masterconfig: Automation Runtime op bestaande engine, Fase 11-architectuur)
--
-- Doel: de bestaande queue kan productief en VEILIG worden gedrained:
--  * atomair claimen (FOR UPDATE SKIP LOCKED) zodat parallelle
--    cron-aanroepen nooit hetzelfde item dubbel uitvoeren;
--  * stale-'processing'-items terugwinnen met begrensde pogingen;
--  * typed runtime-events voor audit.
--
-- GEEN wijziging aan lifecycle-guards, capability matrix of human gates.
-- ============================================================
begin;

-- ------------------------------------------------------------
-- 1. claimed_at bijhouden (stale-detectie).
-- ------------------------------------------------------------
alter table public.automation_queue
  add column if not exists claimed_at timestamptz;

create index if not exists idx_automation_queue_claimed
  on public.automation_queue (status, claimed_at);

-- ------------------------------------------------------------
-- 2. Typed runtime-events mogelijk maken (constraint uitbreiden).
--    Bestaande types blijven ongewijzigd; alleen de vier queue-uitkomsten
--    komen erbij (bron 'runtime').
-- ------------------------------------------------------------
do $$
declare check_name text;
begin
  select conname into check_name
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
   where t.relname = 'automation_events' and c.contype = 'c'
     and pg_get_constraintdef(c.oid) ilike '%type%' and pg_get_constraintdef(c.oid) not ilike '%entity_type%'
     and c.connamespace = 'public'::regnamespace;
  if check_name is not null then
    execute format('alter table public.automation_events drop constraint %I', check_name);
  end if;
end $$;

alter table public.automation_events
  add constraint automation_events_type_check check (type in (
    'lead_created', 'lead_analyzed', 'lead_scored', 'lead_qualified', 'demo_ready',
    'outreach_draft_ready', 'inbound_message_received', 'reply_processed', 'project_created',
    'price_ready', 'website_ready_for_qc', 'qc_completed', 'website_ready_for_silvijn',
    'website_approved', 'automation_started', 'automation_step_started',
    'automation_step_completed', 'automation_step_failed', 'automation_step_blocked',
    'automation_waiting_for_human', 'automation_completed', 'automation_failed',
    'automation_cancelled',
    'queue_item_claimed', 'queue_item_completed', 'queue_item_retried',
    'queue_item_failed', 'queue_item_reclaimed'
  ));

-- ------------------------------------------------------------
-- 3. Atomair claimen: één transactie, SKIP LOCKED. Alleen service-role
--    (de runtime) mag claimen; geauthenticeerde gebruikers hebben hier
--    geen enkele reden toe (queue-afhandeling is geen UI-mutatie).
-- ------------------------------------------------------------
-- p_exclude: items die in DEZE drain al een herkansing kregen. Zo krijgt
-- een tijdelijke fout altijd uitstel tot de volgende cron-run (backoff) in
-- plaats van alle pogingen in één drain te verbranden.
create or replace function public.claim_next_automation_queue_item(p_exclude uuid[] default '{}')
returns public.automation_queue
language sql
set search_path=''
as $$
  with candidate as (
    select id from public.automation_queue
     where status = 'queued'
       and not (id = any(coalesce(p_exclude, '{}'::uuid[])))
     order by enqueued_at asc
     limit 1
     for update skip locked
  )
  update public.automation_queue q
     set status = 'processing', claimed_at = now(), processed_at = null
    from candidate c
   where q.id = c.id
  returning q.*;
$$;

revoke all on function public.claim_next_automation_queue_item(uuid[]) from public, anon, authenticated;
grant execute on function public.claim_next_automation_queue_item(uuid[]) to service_role;

-- ------------------------------------------------------------
-- 4. Stale-'processing' terugwinnen. Een item dat tijdens een crash of
--    cold-stop van de runtime op 'processing' is blijven staan, komt
--    terug in de queue — TENZIJ het maximale aantal pogingen is bereikt,
--    dan faalt het definitief (geen oneindige herkansingen).
-- ------------------------------------------------------------
create or replace function public.reclaim_stale_processing_items(p_older_than timestamptz, p_max_attempts integer)
returns integer
language plpgsql
set search_path=''
as $$
declare reclaimed int;
begin
  if p_max_attempts is null or p_max_attempts < 1 then
    raise exception 'INVALID_MAX_ATTEMPTS';
  end if;

  update public.automation_queue q
     set status = case when q.attempts >= p_max_attempts then 'failed' else 'queued' end,
         attempts = case when q.attempts >= p_max_attempts then q.attempts else q.attempts + 1 end,
         claimed_at = null,
         processed_at = case when q.attempts >= p_max_attempts then now() else q.processed_at end,
         error = case
                   when q.attempts >= p_max_attempts then coalesce(btrim(q.error), '') ||
                     case when coalesce(btrim(q.error), '') = '' then '' else ' | ' end ||
                     'verwerking vastgelopen (stale) — definitief gefaald na max pogingen'
                   else q.error
                 end
   where q.status = 'processing'
     and q.claimed_at is not null
     and q.claimed_at < p_older_than;
  get diagnostics reclaimed = row_count;
  return reclaimed;
end $$;

revoke all on function public.reclaim_stale_processing_items(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.reclaim_stale_processing_items(timestamptz, integer) to service_role;

commit;
