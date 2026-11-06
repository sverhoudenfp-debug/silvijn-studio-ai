-- 0031_shopify_connections.sql
--
-- Eén rij per klantwinkel met een versleuteld offline access token.
-- De winkel (shop) is de tenant-sleutel: alle lees- en schrijfacties filteren
-- daarop, zodat winkels elkaar nooit kunnen zien of overschrijven.
--
-- Beveiliging:
--   - RLS aan, geen policies voor anon/authenticated: alleen servercode met de
--     service-role key komt bij deze tabel.
--   - Tokens staan AES-256-GCM versleuteld (kolom token_ciphertext); de sleutel
--     staat in SHOPIFY_TOKEN_ENCRYPTION_KEY en nooit in de database.
--   - Geen publieke leesrechten, ook niet voor de studio-gebruiker: de UI leest
--     via de server-routes die `listConnections()` gebruiken (zonder tokenmateriaal).

create table if not exists public.shopify_connections (
  id uuid primary key default gen_random_uuid(),
  shop text not null unique,
  scope text not null default '',
  token_ciphertext text not null,
  token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  constraint shopify_connections_shop_format check (shop ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$')
);

comment on table public.shopify_connections is
  'Per klantwinkel een versleuteld offline Shopify-token (authorization code grant, expiring token + refresh).';
comment on column public.shopify_connections.token_ciphertext is
  'AES-256-GCM ciphertext van {accessToken, refreshToken}; sleutel uit SHOPIFY_TOKEN_ENCRYPTION_KEY.';

alter table public.shopify_connections enable row level security;

-- Geen policies: anon en authenticated hebben geen toegang. Service-role bypasst RLS.
revoke all on public.shopify_connections from anon, authenticated;

create index if not exists shopify_connections_updated_at_idx
  on public.shopify_connections (updated_at desc);
