-- 0009: aligneert de status-check-constraint van generated_websites met de
-- Fase 10/11 quality-control-flow.
-- De constraint uit 0006 kende alleen de generatiestatussen; de QC-flow
-- (lib/qc/service.ts, lib/websites/types.ts) schrijft óók:
--   qc_running, ready_for_silvijn, needs_revision, approved
-- De live E2E-test (Fase 12) vond dit: de database wees de QC-statusupdate af.
-- Puur constraint-uitbreiding; geen datawijziging, geen kolomwijziging.

alter table public.generated_websites
  drop constraint if exists generated_websites_status_check;

alter table public.generated_websites
  add constraint generated_websites_status_check
  check (status in (
    'generating', 'generated', 'building', 'ready_for_qc',
    'qc_running', 'ready_for_silvijn', 'needs_revision', 'approved',
    'failed', 'archived'
  ));
