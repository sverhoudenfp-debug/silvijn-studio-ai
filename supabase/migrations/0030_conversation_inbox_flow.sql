-- ============================================================
-- Silvijn Studio AI — Conversation-inboxflow (Gmail → Conversations)
--
-- DOEL (2026-10-01): het dashboard gedraagt zich als een echte
-- inbox/conversation-manager:
--  1. conversations.owner_last_read_at — gelezen-status per gesprek
--     voor een duidelijke "nieuw/ongelezen"-indicator in de UI.
--  2. mark_conversation_read(uuid) — owner-only RPC die het gesprek
--     markeert als gelezen wanneer de eigenaar het opent.
--  3. ingest_gmail_reply v3 (zelfde signatuur, intern versterkt):
--     a. Idempotentie vergelijkt het KALE adres in plaats van de rauwe
--        afzenderstring: historische rijen (pre-normalisatie) bevatten
--        "Naam <adres>" als afzender, nieuwe ingest het kale adres. Het
--       zelfde Gmail-bericht mag daardoor nooit als conflict faalen.
--     b. Bij een afzender-match (zonder p_outreach) worden alle al
--        verzonden outreach-drafts van hetzelfde (lead, contact, kanaal)
--        die nog niet aan een conversation hangen, gekoppeld aan de
--        conversation — zodat de thread ónze uitgaande berichten toont,
--        niet alleen de reacties van de klant.
--  GEEN wijziging aan: pricing, payments, human gates, lifecycle, RLS.
--  Additief en databehoudend; bestaande rijen worden niet herschreven.
-- ============================================================

begin;

alter table public.conversations
  add column if not exists owner_last_read_at timestamptz;

comment on column public.conversations.owner_last_read_at is
  'Laatste moment waarop de eigenaar dit gesprek heeft geopend (ongebruikt/null = nog nooit gelezen; gebruikt voor de ongelezen-indicator)';

-- ------------------------------------------------------------
-- Owner-only: gesprek als gelezen markeren. Alleen de geverifieerde
-- eigenaar; service_role/anon kunnen dit niet (zelfde patroon als
-- record_prospect_reply).
-- ------------------------------------------------------------
create or replace function public.mark_conversation_read(p_conversation uuid)
returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_studio_owner() then
    raise exception 'HUMAN_AUTHORIZATION_REQUIRED' using errcode='42501';
  end if;
  update public.conversations set owner_last_read_at = now()
   where id = p_conversation;
  if not found then raise exception 'CONVERSATION_NOT_FOUND'; end if;
end $$;

revoke all on function public.mark_conversation_read(uuid) from public, anon, service_role;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- ------------------------------------------------------------
-- ingest_gmail_reply v3
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
  p_in_reply_to text default null,
  p_provider_thread_id text default null,
  p_provider_rfc_message_id text default null,
  p_provider_references text default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  normalized_sender text;
  normalized_account text;
  effective_thread text;
  cid uuid;
  mid uuid;
  prior public.inbound_messages;
  prior_address text;
  owner_id uuid;
  conv_id uuid;
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

  -- Thread-referenties zijn optioneel (historische mails, handmatige
  -- ingest), maar een gegeven waarde moet wel een geldige header zijn.
  if p_provider_thread_id is not null and length(btrim(p_provider_thread_id)) not between 1 and 1000 then
    raise exception 'INVALID_THREAD_REFERENCE';
  end if;
  if p_provider_rfc_message_id is not null and length(btrim(p_provider_rfc_message_id)) not between 1 and 1000 then
    raise exception 'INVALID_THREAD_REFERENCE';
  end if;
  if p_provider_references is not null and length(btrim(p_provider_references)) not between 1 and 4000 then
    raise exception 'INVALID_THREAD_REFERENCE';
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
  -- -> bestaande id teruggeven, geen tweede record. De afzender-vergelijking
  -- gebruikt het KALE adres: rijen van vóór de afzender-normalisatie
  -- bevatten "Naam <adres>"; de identiteit van de afzender is het adres,
  -- niet de weergavenaam, dus die formaten zijn dezelfde reactie.
  select * into prior from public.inbound_messages
   where channel = 'email' and provider_account_key = normalized_account and provider_message_id = btrim(p_gmail_message_id);
  if found then
    prior_address := lower(coalesce(substring(prior.sender from '<([^>]+)>'), prior.sender));
    if prior.lead_id <> p_lead or prior_address <> normalized_sender
       or prior.in_reply_to_outreach_id is distinct from p_outreach then
      raise exception 'PROVIDER_MESSAGE_CONFLICT';
    end if;
    return prior.id;
  end if;

  -- confirmed_by: het eigenaarsaccount (reactie is in diens mailbox
  -- geconstateerd via de geautoriseerde Gmail-verbinding).
  select c.owner_user_id into owner_id
    from public.gmail_connections c
    join auth.users u on u.id = c.owner_user_id
    join public.studio_members m on lower(m.email) = lower(u.email) and m.role = 'owner' and m.enabled
   where c.account_key = normalized_account
     and u.email_confirmed_at is not null
   order by c.connected_at limit 1;
  if owner_id is null then raise exception 'NO_VERIFIED_GMAIL_CONNECTION'; end if;

  insert into public.lead_contacts(lead_id, channel, address) values(p_lead, 'email', normalized_sender)
  on conflict (lead_id, channel, address) do update set address = excluded.address
  returning id into cid;

  insert into public.inbound_messages(
    lead_id, contact_id, channel, sender, subject, body, received_at,
    source, reply_confirmed, confirmed_by, request_key,
    in_reply_to_outreach_id, thread_key,
    provider_message_id, provider_account_key,
    provider_thread_id, provider_rfc_message_id, provider_references
  ) values(
    p_lead, cid, 'email', normalized_sender, p_subject, btrim(p_body), p_received,
    'gmail', true, owner_id, null,
    p_outreach, effective_thread,
    btrim(p_gmail_message_id), normalized_account,
    nullif(btrim(coalesce(p_provider_thread_id, '')), ''),
    nullif(btrim(coalesce(p_provider_rfc_message_id, '')), ''),
    nullif(btrim(coalesce(p_provider_references, '')), '')
  )
  on conflict (channel, provider_account_key, provider_message_id) do nothing
  returning id into mid;

  if mid is null then
    -- Racconditie: parallelle ingest heeft het bericht net opgevoerd.
    select id into mid from public.inbound_messages
     where channel = 'email' and provider_account_key = normalized_account and provider_message_id = btrim(p_gmail_message_id);
  end if;

  -- De insert-trigger (attach_confirmed_reply) heeft de conversation
  -- aangemaakt of bijgewerkt. Bij een afzender-match zonder p_outreach
  -- koppelen we de al verzonden outreach van dit (lead, contact, kanaal)
  -- aan dezelfde conversation, zodat de thread beide richtingen toont:
  -- onze uitgaande mails + de reacties van de klant. Alleen drafts die
  -- nog nergens aan hangen; al gekoppelde blijven exact waar ze zijn.
  select conversation_id into conv_id from public.inbound_messages where id = mid;
  if conv_id is not null and p_outreach is null then
    update public.outreach_drafts set conversation_id = conv_id
     where lead_id = p_lead and contact_id = cid and channel = 'email'
       and status = 'sent' and sent_at is not null
       and conversation_id is null;
  end if;

  return mid;
end $$;

revoke all on function public.ingest_gmail_reply(uuid, text, text, text, timestamptz, text, text, text, uuid, text, text, text, text) from public, anon;
grant execute on function public.ingest_gmail_reply(uuid, text, text, text, timestamptz, text, text, text, uuid, text, text, text, text) to authenticated, service_role;

commit;
