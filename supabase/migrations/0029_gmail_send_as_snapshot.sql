-- 0029: Gmail "Verzenden als"-alias (settings.sendAs) — snapshot van de laatste
-- live controle op de verbinding. Additief en nullable; geen tokens, alleen status.
-- Architectuur: primair OAuth-account (silvijn@) + send-as alias (info@) als
-- zichtbaar From-adres van outreach. Nooit een tweede gebruiker/alias aanmaken.
alter table public.gmail_connections
  add column if not exists send_as_email text
    check (send_as_email is null or (send_as_email = lower(send_as_email) and length(send_as_email) between 3 and 320)),
  add column if not exists send_as_status text
    check (send_as_status is null or send_as_status in ('verified', 'pending', 'not_listed', 'unknown')),
  add column if not exists send_as_display_name text,
  add column if not exists send_as_reason text,
  add column if not exists send_as_checked_at timestamptz;

comment on column public.gmail_connections.send_as_email is 'Gecontroleerd "Verzenden als"-alias (GMAIL_SEND_AS), zichtbaar From-adres van outreach.';
comment on column public.gmail_connections.send_as_status is 'Uitkomst laatste live settings.sendAs-controle: verified | pending | not_listed | unknown.';
comment on column public.gmail_connections.send_as_reason is 'Exacte uitleg welke Gmail/Workspace-instelling ontbreekt wanneer status niet verified is.';
