-- ============================================================
-- Silvijn Studio AI — Fase 5: discovery-velden op leads
-- Backward-compatible: twee nullable kolommen + partiële unique index.
-- external_id + source_url laten toe dat een kandidaat later als
-- duplicaat van dezelfde bron wordt herkend.
-- ============================================================

alter table public.leads
  add column if not exists external_id text,
  add column if not exists source_url text;

-- Eén lead per externe bron-ID (waar aanwezig)
create unique index if not exists idx_leads_source_external_id
  on public.leads (source, external_id)
  where external_id is not null;
