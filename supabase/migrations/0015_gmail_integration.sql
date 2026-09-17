-- ============================================================
-- Silvijn Studio AI — Gmail-integratie (Masterconfig C/E)
-- 1. gmail_connections: per provider-account de versleutelde
--    OAuth-credentials en ingest-cursor. RLS aan; eigenaar leest
--    alleen de status (tokens blijven server-side).
-- 2. ingest_gmail_reply: service-role RPC die alléén echte, via de
--    Gmail-API geconstateerde reacties vastlegt. Bewijsplicht:
--    provider_message_id + provider_account_key zijn verplicht
--    (uniek, idempotent); source='gmail' activeert de bestaande
--    conversation-trigger; zonder bewijs blijft de bestaande
--    manual/owner-flow de norm.
-- ============================================================

begin;

create table public.gmail_connections (
  id uuid primary key default gen_random_uuid(),
  account_key text not null unique check (account_key = lower(account_key) and length(account_key) between 3 and 320),
  owner_user_id uuid not null references auth.users (id),
  token_ciphertext text not null,
  token_updated_at timestamptz not null default now(),
  scopes text not null default '',
  connected_at timestamptz not null default now(),
  last_ingest_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.gmail_connections enable row level security;

-- Eigenaar ziet verbindingsstatus (nooit de ciphertext);
-- schrijven verloopt uitsluitend via de service-role/backend.
create policy gmail_connection_owner_read on public.gmail_connections
  for select to authenticated
  using (public.is_studio_owner());

create trigger set_gmail_connections_updated_at
  before update on public.gmail_connections
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- ingest_gmail_reply — idempotente vastlegging van een ECHTE
-- Gmail-reactie. Grotendeels spiegelbeeld van record_prospect_reply,
-- maar: (a) toegestaan voor service_role (geplande ingest zonder
-- sessie) én de geverifieerde eigenaar; (b) confirmed_by is het
-- eigenaarsaccount dat de Gmail-verbinding beheert (het bericht ligt
-- fysiek in diens mailbox); (c) provider-bewijs is verplicht en
-- uniek — hetzelfde Gmail-bericht kan nooit tweemaal ontstaan.
-- ------------------------------------------------------------
create or replace function public.ingest_gmail_reply(
  p_lead uuid,
  p_sender text,
  p_subject text,
  p_body text,
  p_received timestamptz,
  p_gmail_message_id text,
  p_account_key text,
  p_thread text default null,
  p_outreach uuid default null,
  p_in_reply_to text default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  normalized_sender text;
  normalized_account text;
  effective_thread text;
  cid uuid;
  mid uuid;
  prior public.inbound_messages;
  owner_id uuid;
begin
  -- Toegang: geverifieerde eigenaar, of service-role (auth.uid() is null).
  if auth.uid() is not null and not public.is_studio_owner() then
    raise exception 'HUMAN_AUTHORIZATION_REQUIRED' using errcode='42501';
  end if;

  -- Provider-bewijs is verplicht: geen bewijs = geen reactie.
  if p_gmail_message_id is null or length(btrim(p_gmail_message_id)) not between 1 and 1000
     or p_account_key is null or length(btrim(p_account_key)) not between 3 and 320 then
    raise exception 'PROVIDER_EVIDENCE_REQUIRED';
  end if;

  if p_received is null or p_received > now() + interval '5 minutes'
     or p_sender is null or length(btrim(p_sender)) not between 1 and 500
     or p_body is null or length(btrim(p_body)) not between 1 and 50000
     or p_subject is null or length(p_subject) > 1000 then
    raise exception 'INVALID_REPLY';
  end if;

  perform 1 from public.leads where id = p_lead for update;
  if not found then raise exception 'LEAD_NOT_FOUND'; end if;

  normalized_sender := lower(btrim(p_sender));
  normalized_account := lower(btrim(p_account_key));
  -- Reacties van het studio-account zelf zijn nooit prospect-reacties.
  if normalized_sender = normalized_account then raise exception 'SELF_REPLY_IGNORED'; end if;

  effective_thread := coalesce(nullif(btrim(p_thread), ''), 'gmail:' || normalized_account || ':' || btrim(p_gmail_message_id));
  if length(effective_thread) > 300 then effective_thread := left(effective_thread, 300); end if;

  -- Idempotentie op providersleutel: hetzelfde Gmail-bericht bestaat al
  -- → bestaande id teruggeven, geen tweede record.
  select * into prior from public.inbound_messages
   where channel = 'email' and provider_account_key = normalized_account and provider_message_id = btrim(p_gmail_message_id);
  if found then
    if prior.lead_id <> p_lead or prior.sender <> normalized_sender
       or prior.in_reply_to_outreach_id is distinct from p_outreach then
      raise exception 'PROVIDER_MESSAGE_CONFLICT';
    end if;
    return prior.id;
  end if;

  -- confirmed_by: het eigenaarsaccount (reactie is in diens mailbox
  -- geconstateerd via de geautoriseerde Gmail-verbinding). De verbinding
  -- moet daadwerkelijk bestaan en aan dit account gekoppeld zijn.
  select c.owner_user_id into owner_id
    from public.gmail_connections c
    join auth.users u on u.id = c.owner_user_id
    join public.studio_members m on lower(m.email) = lower(u.email) and m.role = 'owner' and m.enabled
   where c.account_key = normalized_account
     and u.email_confirmed_at is not null
   order by c.connected_at limit 1;
  if owner_id is null then raise exception 'NO_VERIFIED_GMAIL_CONNECTION'; end if;

  insert into public.lead_contacts(lead_id, channel, address) values(p_lead, 'email', normalized_sender)
  on conflict(lead_id, channel, address) do update set address = excluded.address
  returning id into cid;

  insert into public.inbound_messages(
    lead_id, contact_id, channel, sender, subject, body, received_at,
    source, reply_confirmed, confirmed_by, request_key,
    in_reply_to_outreach_id, thread_key,
    provider_message_id, provider_account_key
  ) values(
    p_lead, cid, 'email', normalized_sender, p_subject, btrim(p_body), p_received,
    'gmail', true, owner_id, null,
    p_outreach, effective_thread,
    btrim(p_gmail_message_id), normalized_account
  )
  on conflict (channel, provider_account_key, provider_message_id) do nothing
  returning id into mid;

  if mid is null then
    -- Racconditie: parallelle ingest heeft het bericht net opgevoerd.
    select id into mid from public.inbound_messages
     where channel = 'email' and provider_account_key = normalized_account and provider_message_id = btrim(p_gmail_message_id);
  end if;

  return mid;
end $$;

revoke all on function public.ingest_gmail_reply(uuid, text, text, text, timestamptz, text, text, text, uuid, text) from public, anon;
grant execute on function public.ingest_gmail_reply(uuid, text, text, text, timestamptz, text, text, text, uuid, text) to authenticated, service_role;

-- ------------------------------------------------------------
-- Guard-amendement: provider-geverifieerde Gmail-reacties zijn zonder
-- browsersessie bevestigbaar, uitsluitend wanneer het bericht bij een
-- echte geautoriseerde verbinding van de eigenaar hoort. Alle andere
-- wegen blijven exact zoals in 0012 (owner in eigen persoon, auth.uid()).
-- ------------------------------------------------------------
create or replace function public.guard_message_identity() returns trigger language plpgsql set search_path='' as $$
declare contact_address text;
begin
 if TG_OP='UPDATE' and (old.lead_id<>new.lead_id or old.channel<>new.channel or old.contact_id is distinct from new.contact_id) then
  raise exception 'MESSAGE_IDENTITY_IMMUTABLE';
 end if;
 if new.contact_id is not null then
  select address into contact_address from public.lead_contacts where id=new.contact_id and lead_id=new.lead_id and channel=new.channel;
  if contact_address is null or contact_address<>(case when new.channel='email' then lower(btrim(new.sender)) else btrim(new.sender) end) then raise exception 'SENDER_CONTACT_MISMATCH'; end if;
 end if;
 if TG_OP='UPDATE' and old.reply_confirmed and (not new.reply_confirmed or old.confirmed_by is distinct from new.confirmed_by or old.body<>new.body or old.subject<>new.subject or old.source<>new.source or old.in_reply_to_outreach_id is distinct from new.in_reply_to_outreach_id or old.provider_message_id is distinct from new.provider_message_id or old.provider_account_key is distinct from new.provider_account_key or old.sender<>new.sender or old.received_at<>new.received_at or old.thread_key<>new.thread_key or old.request_key is distinct from new.request_key or (old.conversation_id is not null and old.conversation_id is distinct from new.conversation_id)) then raise exception 'CONFIRMED_REPLY_IMMUTABLE'; end if;
 if new.reply_confirmed and (TG_OP='INSERT' or not old.reply_confirmed) then
  if new.source in ('mock','test') then raise exception 'SYNTHETIC_REPLY_CANNOT_ACTIVATE_CONVERSATION'; end if;
  if not (
    (public.is_studio_owner() and new.confirmed_by is not distinct from auth.uid())
    or
    (new.source = 'gmail' and new.provider_message_id is not null and new.provider_account_key is not null
     and new.confirmed_by is not null
     and exists (select 1 from public.gmail_connections c
                  where c.account_key = new.provider_account_key
                    and c.owner_user_id = new.confirmed_by))
  ) then raise exception 'VERIFIED_REPLY_CONFIRMATION_REQUIRED' using errcode='42501'; end if;
  if new.in_reply_to_outreach_id is not null and not exists(select 1 from public.outreach_drafts o where o.id=new.in_reply_to_outreach_id and o.status='sent') then raise exception 'REPLY_TARGET_NOT_SENT'; end if;
 end if;
 return new;
end $$;

revoke all on function public.guard_message_identity() from public, anon, authenticated, service_role;

commit;
