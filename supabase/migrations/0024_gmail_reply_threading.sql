-- ============================================================
-- Silvijn Studio AI — Gmail reply-threading (fix open punt Fase C)
--
-- PROBLEEM: AI-antwoorden op prospect-reacties werden verstuurd als
-- losse nieuwe e-mails: gmailSend zette geen In-Reply-To/References
-- en stuurde geen Gmail-threadId mee, en de ingest bewaarde de
-- thread-referenties (Gmail-threadId, RFC Message-ID en References
-- van de klantmail) helemaal niet. p_in_reply_to werd door
-- ingest_gmail_reply geaccepteerd maar nergens gebruikt.
--
-- FIX (additief, databehoudend):
-- 1. inbound_messages krijgt drie NULLABLE kolommen:
--    provider_thread_id       - Gmail-threadId van de klantmail
--    provider_rfc_message_id - RFC822 Message-ID-header van de klantmail
--    provider_references     - References-header van de klantmail
--    Bestaande rijen krijgen NULL (historische mails); geen enkele
--    bestaande kolom, constraint, guard of policy verandert.
-- 2. ingest_gmail_reply wordt vervangen door een versie met drie
--    extra optionele parameters die deze velden vastlegt. Zelfde
--    bewijsplicht, idempotentie en guards; service_role + eigenaar
--    blijven de enige uitvoerders.
--
-- GEEN wijziging aan: pricing, payments, website-goedkeuring,
-- productie-poort, website-generatie, human-approval gates.
-- ============================================================

begin;

alter table public.inbound_messages
  add column if not exists provider_thread_id text,
  add column if not exists provider_rfc_message_id text,
  add column if not exists provider_references text;

comment on column public.inbound_messages.provider_thread_id is
  'Gmail-threadId van de klantmail; gebruikt om AI-antwoorden in dezelfde Gmail-thread te plaatsen';
comment on column public.inbound_messages.provider_rfc_message_id is
  'RFC822 Message-ID-header van de klantmail; gebruikt als In-Reply-To bij het beantwoorden';
comment on column public.inbound_messages.provider_references is
  'References-header van de klantmail; basis voor de References-keten in het antwoord';

-- ------------------------------------------------------------
-- ingest_gmail_reply v2: zelfde contract + thread-referenties.
-- De oude signatuur (10 params) bestaat niet meer; de nieuwe heeft
-- drie extra optionele parameters (default null), dus bestaande
-- PostgREST-aanroepen blijven geldig.
-- ------------------------------------------------------------
drop function if exists public.ingest_gmail_reply(uuid, text, text, text, timestamptz, text, text, text, uuid, text);

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
  -- -> bestaande id teruggeven, geen tweede record. De thread-referenties
  -- van een al vastgelegd bericht worden NIET bijgewerkt (confirmed
  -- reacties zijn immutabel); ze zijn bij de eerste ingest gezet of null.
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

  return mid;
end $$;

revoke all on function public.ingest_gmail_reply(uuid, text, text, text, timestamptz, text, text, text, uuid, text, text, text, text) from public, anon;
grant execute on function public.ingest_gmail_reply(uuid, text, text, text, timestamptz, text, text, text, uuid, text, text, text, text) to authenticated, service_role;

commit;
