-- 0025_theme_certification.sql (2026-09-21)
-- PRODUCTION THEME PREFLIGHT / THEME CERTIFICATION:
-- 1. Nieuwe artefact-statussen: 'certified' (volledige preflight doorstaan,
--    incl. extern Shopify Theme Check) en 'preflight_failed' (critical
--    preflight-fout: nooit leverbaar, nooit READY_FOR_SILVIJN).
--    Legacy-statussen 'passed'/'failed' blijven geldig: historische
--    artefacten worden nooit herschreven (bewijsbehoud).
-- 2. Additieve kolom `preflight` (jsonb): het volledige preflight-rapport
--    (checks, warnings, externe scan, reparaties) als duurzaam
--    certificeringsbewijs bij elk artefact.
-- Databehoudend: geen bestaande kolom of rij wordt gewijzigd of verwijderd.

begin;

alter table public.theme_zip_artifacts
  add column if not exists preflight jsonb;

alter table public.theme_zip_artifacts
  drop constraint if exists theme_zip_artifacts_status_check;

alter table public.theme_zip_artifacts
  add constraint theme_zip_artifacts_status_check
  check (status in ('validating', 'passed', 'failed', 'certified', 'preflight_failed'));

comment on column public.theme_zip_artifacts.preflight is
  'Theme Certification: volledig preflight-rapport (status, checks, warnings, extern Theme Check, reparaties) — duurzaam bewijs dat de ZIP Shopify-technisch gecertificeerd is.';

commit;
