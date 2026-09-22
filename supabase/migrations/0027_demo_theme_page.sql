-- 0027 — G4: gratis één-pagina-demo via het eigen thema (additief).
-- Bestaande legacy-template-demo's blijven byte-ongewijzigd. Nieuwe demo's
-- worden als zelfstandig HTML-document opgeslagen (gerenderd uit ons eigen
-- Shopify-thema) en via /demo/<slug> publiek geserveerd totdat Silvijn
-- verwijdering opdraagt (masterconfig Part 2).
begin;

alter table public.demo_websites
  add column if not exists source text not null default 'legacy_template',
  add column if not exists rendered_html text null,
  add column if not exists theme_sha256 text null,
  add column if not exists generated_at timestamptz null,
  add column if not exists generation_notes jsonb not null default '[]'::jsonb;

alter table public.demo_websites
  drop constraint if exists demo_websites_source_check;
alter table public.demo_websites
  add constraint demo_websites_source_check
  check (source in ('legacy_template', 'theme_page'));

-- Template-enum uitbreiden met de themaroute; bestaande waarden blijven geldig.
alter table public.demo_websites
  drop constraint if exists demo_websites_template_check;
alter table public.demo_websites
  add constraint demo_websites_template_check
  check (template in ('local_service', 'professional_service', 'home_improvement', 'business_standard', 'theme_page'));

-- Een theme_page-demo die "ready" is, moet daadwerkelijk HTML bevatten.
alter table public.demo_websites
  drop constraint if exists demo_websites_theme_page_html_check;
alter table public.demo_websites
  add constraint demo_websites_theme_page_html_check
  check (source <> 'theme_page' or status <> 'ready' or (rendered_html is not null and length(rendered_html) > 0 and theme_sha256 is not null));

-- Rechten ongewijzigd: RLS aan (0010), anon/authenticated geen schrijfrechten;
-- service-role schrijft uitsluitend via de server-side repository.
revoke insert, update, delete on public.demo_websites from anon, authenticated;

commit;
