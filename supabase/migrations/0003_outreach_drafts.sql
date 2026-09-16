-- ============================================================
-- Silvijn Studio AI — Fase 6: outreach_drafts
-- Concepten (drafts) voor AI-outreach. RLS aan zonder publiek
-- beleid: toegang verloopt uitsluitend server-side via secret key.
-- "sent" wordt pas in een latere fase met expliciete approval gezet.
-- ============================================================

create table if not exists public.outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  channel text not null default 'email'
    check (channel in ('email', 'linkedin', 'phone', 'other')),
  status text not null default 'draft'
    check (status in ('draft', 'ready_for_review', 'approved', 'sent', 'failed', 'cancelled')),
  subject text not null default '',
  body text not null default '',
  personalization_reason text not null default '',
  call_to_action text not null default '',
  model text not null default '',
  ai_run_id uuid,
  quality_issues text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_outreach_drafts_lead_id
  on public.outreach_drafts (lead_id);

create index if not exists idx_outreach_drafts_status
  on public.outreach_drafts (status);

alter table public.outreach_drafts enable row level security;

create trigger set_outreach_drafts_updated_at
  before update on public.outreach_drafts
  for each row execute function public.set_updated_at();
