-- ============================================================
-- Silvijn Studio AI — seed data (gegenereerd door scripts/generate-seed.ts)
-- Uitsluitend FICTIEVE bedrijven. Draai eerst supabase/migrations/0001_init.sql.
-- ============================================================

insert into public.leads (
  id, business_name, industry, address, postal_code, city, province, country,
  phone, email, website, website_status, google_rating, review_count,
  lead_score, lead_status, outreach_status, demo_status, source, notes, ai_summary,
  created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000001'::uuid, 'Jansen Dakwerken', 'Dakwerken', 'Dakpanstraat 12',
  '5612 AB', 'Eindhoven', 'Noord-Brabant', 'Nederland',
  '+31 40 123 4567', 'info@jansendakwerken.nl', null, 'no_website',
  4.8, 87, 88,
  'interested', 'replied', 'ready',
  'mock', array['Klant reageerde enthousiast op de demo.']::text[], '{"businessSummary":"Local dakwerken company serving customers in Eindhoven and surrounding areas with 87 customer reviews.","opportunity":"Strong opportunity for a modern lead-generation website — customers search online but the business has no website.","potentialProblems":"No professional website detected; visibility depends fully on offline channels.","recommendedApproach":"Create a conversion-focused local service website with clear CTAs, a service overview and contact options."}'::jsonb,
  '2026-09-14T20:31:00.000Z', '2026-09-15T20:50:00.000Z'
);

insert into public.leads (
  id, business_name, industry, address, postal_code, city, province, country,
  phone, email, website, website_status, google_rating, review_count,
  lead_score, lead_status, outreach_status, demo_status, source, notes, ai_summary,
  created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000002'::uuid, 'Van der Berg Loodgieters', 'Loodgieters', 'Leidingweg 8',
  '3021 CD', 'Rotterdam', 'Zuid-Holland', 'Nederland',
  '+31 10 234 5678', 'info@vanderberg-loodgieters.nl', null, 'no_website',
  4.6, 132, 92,
  'qualified', 'opened', 'ready',
  'mock', array[]::text[], '{"businessSummary":"Local loodgieters company serving customers in Rotterdam and surrounding areas with 132 customer reviews.","opportunity":"Strong opportunity for a modern lead-generation website — customers search online but the business has no website.","potentialProblems":"No professional website detected; visibility depends fully on offline channels.","recommendedApproach":"Create a conversion-focused local service website with clear CTAs, a service overview and contact options."}'::jsonb,
  '2026-09-13T09:12:00.000Z', '2026-09-14T11:03:00.000Z'
);

insert into public.leads (
  id, business_name, industry, address, postal_code, city, province, country,
  phone, email, website, website_status, google_rating, review_count,
  lead_score, lead_status, outreach_status, demo_status, source, notes, ai_summary,
  created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000003'::uuid, 'Bakker Installatietechniek', 'Installatietechniek', 'Ketelstraat 45',
  '4811 GH', 'Breda', 'Noord-Brabant', 'Nederland',
  '+31 76 555 0192', 'info@bakkerinstallatie.nl', null, 'no_website',
  4.7, 98, 87,
  'contacted', 'sent', 'ready',
  'mock', array[]::text[], '{"businessSummary":"Local installatietechniek company serving customers in Breda and surrounding areas with 98 customer reviews.","opportunity":"Strong opportunity for a modern lead-generation website — customers search online but the business has no website.","potentialProblems":"No professional website detected; visibility depends fully on offline channels.","recommendedApproach":"Create a conversion-focused local service website with clear CTAs, a service overview and contact options."}'::jsonb,
  '2026-09-12T14:40:00.000Z', '2026-09-14T09:25:00.000Z'
);

insert into public.leads (
  id, business_name, industry, address, postal_code, city, province, country,
  phone, email, website, website_status, google_rating, review_count,
  lead_score, lead_status, outreach_status, demo_status, source, notes, ai_summary,
  created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000004'::uuid, 'Groen & Co Hoveniers', 'Hoveniers', 'Tuinlaan 3',
  '2513 KL', 'Den Haag', 'Zuid-Holland', 'Nederland',
  '+31 70 456 7890', 'info@groenenco.nl', null, 'no_website',
  4.4, 58, 78,
  'interested', 'replied', 'ready',
  'mock', array['Vraagt naar onderhoudsmogelijkheden.']::text[], '{"businessSummary":"Local hoveniers company serving customers in Den Haag and surrounding areas with 58 customer reviews.","opportunity":"Strong opportunity for a modern lead-generation website — customers search online but the business has no website.","potentialProblems":"No professional website detected; visibility depends fully on offline channels.","recommendedApproach":"Create a conversion-focused local service website with clear CTAs, a service overview and contact options."}'::jsonb,
  '2026-09-12T08:02:00.000Z', '2026-09-14T17:30:00.000Z'
);

insert into public.leads (
  id, business_name, industry, address, postal_code, city, province, country,
  phone, email, website, website_status, google_rating, review_count,
  lead_score, lead_status, outreach_status, demo_status, source, notes, ai_summary,
  created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000005'::uuid, 'Elektro Vries', 'Elektriciens', 'Schakelstraat 21',
  '8011 MP', 'Zwolle', 'Overijssel', 'Nederland',
  '+31 38 567 8901', 'service@elektrovries.nl', null, 'no_website',
  4.7, 76, 84,
  'contacted', 'sent', 'generating',
  'mock', array[]::text[], '{"businessSummary":"Local elektriciens company serving customers in Zwolle and surrounding areas with 76 customer reviews.","opportunity":"Strong opportunity for a modern lead-generation website — customers search online but the business has no website.","potentialProblems":"No professional website detected; visibility depends fully on offline channels.","recommendedApproach":"Create a conversion-focused local service website with clear CTAs, a service overview and contact options."}'::jsonb,
  '2026-09-11T16:22:00.000Z', '2026-09-14T18:48:00.000Z'
);

insert into public.leads (
  id, business_name, industry, address, postal_code, city, province, country,
  phone, email, website, website_status, google_rating, review_count,
  lead_score, lead_status, outreach_status, demo_status, source, notes, ai_summary,
  created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000006'::uuid, 'Schilderwerken De Wit', 'Schilders', 'Kwaststraat 17',
  '1013 PP', 'Amsterdam', 'Noord-Holland', 'Nederland',
  '+31 20 678 9012', null, null, 'no_website',
  4.3, 41, 67,
  'analyzing', 'draft', 'not_created',
  'mock', array[]::text[], '{"businessSummary":"Local schilders company serving customers in Amsterdam and surrounding areas with 41 customer reviews.","opportunity":"Strong opportunity for a modern lead-generation website — customers search online but the business has no website.","potentialProblems":"No professional website detected; visibility depends fully on offline channels.","recommendedApproach":"Create a conversion-focused local service website with clear CTAs, a service overview and contact options."}'::jsonb,
  '2026-09-11T10:45:00.000Z', '2026-09-13T19:12:00.000Z'
);

insert into public.leads (
  id, business_name, industry, address, postal_code, city, province, country,
  phone, email, website, website_status, google_rating, review_count,
  lead_score, lead_status, outreach_status, demo_status, source, notes, ai_summary,
  created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000007'::uuid, 'Garage Veldhuis', 'Autogarages', 'Motordreef 9',
  '9713 AR', 'Groningen', 'Groningen', 'Nederland',
  '+31 50 789 0123', 'info@garageveldhuis.nl', null, 'no_website',
  4.5, 96, 84,
  'qualified', 'opened', 'ready',
  'mock', array[]::text[], '{"businessSummary":"Local autogarages company serving customers in Groningen and surrounding areas with 96 customer reviews.","opportunity":"Strong opportunity for a modern lead-generation website — customers search online but the business has no website.","potentialProblems":"No professional website detected; visibility depends fully on offline channels.","recommendedApproach":"Create a conversion-focused local service website with clear CTAs, a service overview and contact options."}'::jsonb,
  '2026-09-10T12:18:00.000Z', '2026-09-13T10:07:00.000Z'
);

insert into public.leads (
  id, business_name, industry, address, postal_code, city, province, country,
  phone, email, website, website_status, google_rating, review_count,
  lead_score, lead_status, outreach_status, demo_status, source, notes, ai_summary,
  created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000008'::uuid, 'Van Dijk Bouw', 'Bouwbedrijven', 'Funderingsweg 102',
  '5015 BX', 'Tilburg', 'Noord-Brabant', 'Nederland',
  '+31 13 444 2200', 'contact@vandijkbouw.nl', 'www.vandijkbouw.nl', 'has_website',
  4.6, 64, 52,
  'new', 'not_contacted', 'not_created',
  'mock', array[]::text[], '{"businessSummary":"Local bouwbedrijven company serving customers in Tilburg and surrounding areas with 64 customer reviews.","opportunity":"Modernize the existing web presence for better mobile experience and conversion.","potentialProblems":"Current website underperforms on mobile speed and layout.","recommendedApproach":"Create a conversion-focused local service website with clear CTAs, a service overview and contact options."}'::jsonb,
  '2026-09-10T09:30:00.000Z', '2026-09-10T09:30:00.000Z'
);

insert into public.leads (
  id, business_name, industry, address, postal_code, city, province, country,
  phone, email, website, website_status, google_rating, review_count,
  lead_score, lead_status, outreach_status, demo_status, source, notes, ai_summary,
  created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000009'::uuid, 'Keukens van Velzen', 'Keukenzaken', 'Werkbladlaan 5',
  '1315 KD', 'Almere', 'Flevoland', 'Nederland',
  '+31 36 012 3456', 'info@keukensvanvelzen.nl', 'www.keukensvanvelzen.nl', 'website_poor',
  4.2, 29, 57,
  'new', 'not_contacted', 'not_created',
  'mock', array[]::text[], '{"businessSummary":"Local keukenzaken company serving customers in Almere and surrounding areas with 29 customer reviews.","opportunity":"Modernize the existing web presence for better mobile experience and conversion.","potentialProblems":"Current website underperforms on mobile speed and layout.","recommendedApproach":"Create a conversion-focused local service website with clear CTAs, a service overview and contact options."}'::jsonb,
  '2026-09-09T15:05:00.000Z', '2026-09-09T15:05:00.000Z'
);

insert into public.leads (
  id, business_name, industry, address, postal_code, city, province, country,
  phone, email, website, website_status, google_rating, review_count,
  lead_score, lead_status, outreach_status, demo_status, source, notes, ai_summary,
  created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000010'::uuid, 'Helder Schoonmaak', 'Schoonmaak', 'Gladstraat 33',
  '3511 SX', 'Utrecht', 'Utrecht', 'Nederland',
  '+31 30 221 8890', 'info@helderschoonmaak.nl', null, 'no_website',
  4.1, 33, 68,
  'new', 'not_contacted', 'not_created',
  'mock', array[]::text[], '{"businessSummary":"Local schoonmaak company serving customers in Utrecht and surrounding areas with 33 customer reviews.","opportunity":"Strong opportunity for a modern lead-generation website — customers search online but the business has no website.","potentialProblems":"No professional website detected; visibility depends fully on offline channels.","recommendedApproach":"Create a conversion-focused local service website with clear CTAs, a service overview and contact options."}'::jsonb,
  '2026-09-08T11:44:00.000Z', '2026-09-08T11:44:00.000Z'
);

insert into public.leads (
  id, business_name, industry, address, postal_code, city, province, country,
  phone, email, website, website_status, google_rating, review_count,
  lead_score, lead_status, outreach_status, demo_status, source, notes, ai_summary,
  created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000011'::uuid, 'Wolters Schilders', 'Schilders', 'Verflaan 28',
  '2011 ZK', 'Haarlem', 'Noord-Holland', 'Nederland',
  '+31 23 445 6789', 'info@woltersschilders.nl', null, 'no_website',
  4.9, 112, 90,
  'contacted', 'replied', 'failed',
  'mock', array['Demo-generatie mislukt — opnieuw plannen.']::text[], '{"businessSummary":"Local schilders company serving customers in Haarlem and surrounding areas with 112 customer reviews.","opportunity":"Strong opportunity for a modern lead-generation website — customers search online but the business has no website.","potentialProblems":"No professional website detected; visibility depends fully on offline channels.","recommendedApproach":"Create a conversion-focused local service website with clear CTAs, a service overview and contact options."}'::jsonb,
  '2026-09-07T13:20:00.000Z', '2026-09-13T09:41:00.000Z'
);

insert into public.leads (
  id, business_name, industry, address, postal_code, city, province, country,
  phone, email, website, website_status, google_rating, review_count,
  lead_score, lead_status, outreach_status, demo_status, source, notes, ai_summary,
  created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000012'::uuid, 'De Roode Dakwerken', 'Dakwerken', 'Nokstraat 71',
  '7511 ZC', 'Enschede', 'Overijssel', 'Nederland',
  '+31 53 333 4455', 'info@deroodedakwerken.nl', null, 'no_website',
  4.6, 203, 94,
  'qualified', 'opened', 'ready',
  'mock', array[]::text[], '{"businessSummary":"Local dakwerken company serving customers in Enschede and surrounding areas with 203 customer reviews.","opportunity":"Strong opportunity for a modern lead-generation website — customers search online but the business has no website.","potentialProblems":"No professional website detected; visibility depends fully on offline channels.","recommendedApproach":"Create a conversion-focused local service website with clear CTAs, a service overview and contact options."}'::jsonb,
  '2026-09-06T17:55:00.000Z', '2026-09-14T08:19:00.000Z'
);

insert into public.leads (
  id, business_name, industry, address, postal_code, city, province, country,
  phone, email, website, website_status, google_rating, review_count,
  lead_score, lead_status, outreach_status, demo_status, source, notes, ai_summary,
  created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000013'::uuid, 'Prins Loodgieters', 'Loodgieters', 'Kraanstraat 14',
  '7311 AA', 'Apeldoorn', 'Gelderland', 'Nederland',
  '+31 55 122 3344', null, 'www.prinsloodgieters.nl', 'website_poor',
  4, 24, 49,
  'lost', 'opted_out', 'not_created',
  'mock', array['Heeft aangegeven geen interesse te hebben.']::text[], '{"businessSummary":"Local loodgieters company serving customers in Apeldoorn and surrounding areas with 24 customer reviews.","opportunity":"Modernize the existing web presence for better mobile experience and conversion.","potentialProblems":"Current website underperforms on mobile speed and layout.","recommendedApproach":"Create a conversion-focused local service website with clear CTAs, a service overview and contact options."}'::jsonb,
  '2026-09-05T09:02:00.000Z', '2026-09-11T14:00:00.000Z'
);

insert into public.leads (
  id, business_name, industry, address, postal_code, city, province, country,
  phone, email, website, website_status, google_rating, review_count,
  lead_score, lead_status, outreach_status, demo_status, source, notes, ai_summary,
  created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000014'::uuid, 'Sterk Elektro', 'Elektriciens', 'Voltstraat 50',
  '6511 AB', 'Nijmegen', 'Gelderland', 'Nederland',
  '+31 24 901 2345', 'info@sterkelektro.nl', null, 'unknown',
  4.8, 77, 63,
  'won', 'interested', 'not_created',
  'mock', array['Wordt klant — project in ontwikkeling.']::text[], '{"businessSummary":"Local elektriciens company serving customers in Nijmegen and surrounding areas with 77 customer reviews.","opportunity":"Strong opportunity for a modern lead-generation website — customers search online but the business has no website.","potentialProblems":"Current website underperforms on mobile speed and layout.","recommendedApproach":"Create a conversion-focused local service website with clear CTAs, a service overview and contact options."}'::jsonb,
  '2026-09-04T10:26:00.000Z', '2026-09-15T16:44:00.000Z'
);

insert into public.leads (
  id, business_name, industry, address, postal_code, city, province, country,
  phone, email, website, website_status, google_rating, review_count,
  lead_score, lead_status, outreach_status, demo_status, source, notes, ai_summary,
  created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000015'::uuid, 'Vos Hoveniers', 'Hoveniers', 'Boslaan 88',
  '6211 XC', 'Maastricht', 'Limburg', 'Nederland',
  '+31 43 556 7788', 'info@voshoveniers.nl', null, 'no_website',
  4.5, 49, 78,
  'analyzing', 'draft', 'not_created',
  'mock', array[]::text[], '{"businessSummary":"Local hoveniers company serving customers in Maastricht and surrounding areas with 49 customer reviews.","opportunity":"Strong opportunity for a modern lead-generation website — customers search online but the business has no website.","potentialProblems":"No professional website detected; visibility depends fully on offline channels.","recommendedApproach":"Create a conversion-focused local service website with clear CTAs, a service overview and contact options."}'::jsonb,
  '2026-09-03T14:38:00.000Z', '2026-09-12T18:26:00.000Z'
);

insert into public.demo_websites (
  id, lead_id, slug, business_name, industry, city, template, status,
  generation_status, headline, description, services, cta_text, notes,
  preview_url, created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000001001'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'jansen-dakwerken',
  'Jansen Dakwerken', 'Dakwerken', 'Eindhoven', 'home_improvement',
  'ready', 'completed', 'Een dak waar u op kunt vertrouwen',
  'Jansen Dakwerken verzorgt nieuwe daken, renovatie en onderhoud in Eindhoven en omstreken. Vakkundig werk, met garantie en heldere prijzen.', array['Nieuwe daken', 'Dakrenovatie', 'Onderhoud en reparatie', 'Dakisolatie']::text[], 'Vraag vandaag nog een gratis dakinspectie aan', 'Eerste versie — klant reageerde positief.',
  '/demo/jansen-dakwerken', '2026-09-14T20:33:00.000Z', '2026-09-15T20:33:00.000Z'
);

insert into public.demo_websites (
  id, lead_id, slug, business_name, industry, city, template, status,
  generation_status, headline, description, services, cta_text, notes,
  preview_url, created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000001002'::uuid, '00000000-0000-4000-8000-000000000002'::uuid, 'van-der-berg-loodgieters',
  'Van der Berg Loodgieters', 'Loodgieters', 'Rotterdam', 'local_service',
  'ready', 'completed', 'Snelle hulp bij lekkages en verstoppingen',
  'Van der Berg Loodgieters helpt Rotterdam en omstreken binnen het uur bij lekkages, verstoppingen en al het sanitairwerk. Direct, netjes en met garantie.', array['Loodgieterswerk', 'Ontstoppen', 'Lekkages oplossen', 'Sanitair installeren']::text[], 'Bel voor directe hulp in Rotterdam', '',
  '/demo/van-der-berg-loodgieters', '2026-09-13T09:30:00.000Z', '2026-09-13T09:30:00.000Z'
);

insert into public.demo_websites (
  id, lead_id, slug, business_name, industry, city, template, status,
  generation_status, headline, description, services, cta_text, notes,
  preview_url, created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000001003'::uuid, '00000000-0000-4000-8000-000000000003'::uuid, 'bakker-installatietechniek',
  'Bakker Installatietechniek', 'Installatietechniek', 'Breda', 'professional_service',
  'ready', 'completed', 'Complete installatietechniek voor thuis en werk',
  'Van verwarming tot ventilatie: Bakker Installatietechniek ontwerpt, installeert en onderhoudt installaties in Breda en omgeving. Duurzaam en energiezuinig.', array['Verwarming', 'Ventilatie', 'Airconditioning', 'Duurzaam advies']::text[], 'Plan een vrijblijvend adviesgesprek', '',
  '/demo/bakker-installatietechniek', '2026-09-12T15:10:00.000Z', '2026-09-14T11:00:00.000Z'
);

insert into public.demo_websites (
  id, lead_id, slug, business_name, industry, city, template, status,
  generation_status, headline, description, services, cta_text, notes,
  preview_url, created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000001004'::uuid, '00000000-0000-4000-8000-000000000004'::uuid, 'groen-co-hoveniers',
  'Groen & Co Hoveniers', 'Hoveniers', 'Den Haag', 'local_service',
  'ready', 'completed', 'Uw tuin, verzorgd door vakmensen',
  'Groen & Co Hoveniers legt tuinen aan en onderhoudt ze het hele jaar door in Den Haag en omstreken. Van ontwerp tot snoeiwerk.', array['Tuinonderhoud', 'Tuinaanleg', 'Snoeiwerk', 'Bestrating']::text[], 'Vraag een vrijblijvende offerte aan', '',
  '/demo/groen-co-hoveniers', '2026-09-12T08:45:00.000Z', '2026-09-14T17:31:00.000Z'
);

insert into public.demo_websites (
  id, lead_id, slug, business_name, industry, city, template, status,
  generation_status, headline, description, services, cta_text, notes,
  preview_url, created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000001005'::uuid, '00000000-0000-4000-8000-000000000005'::uuid, 'elektro-vries',
  'Elektro Vries', 'Elektriciens', 'Zwolle', 'professional_service',
  'generating', 'generating', 'Elektrisch werk waar u op kunt rekenen',
  'Elektro Vries verzorgt installatiewerk, storingen en keuringen in Zwolle en omgeving. Veilig, gecertificeerd en met heldere rapportage.', array['Installatiewerk', 'Storingen oplossen', 'Verlichting', 'Veiligheidskeuring']::text[], 'Vraag een vrijblijvende offerte aan', 'Generatie loopt — preview volgt.',
  '/demo/elektro-vries', '2026-09-15T14:02:00.000Z', '2026-09-15T14:02:00.000Z'
);

insert into public.demo_websites (
  id, lead_id, slug, business_name, industry, city, template, status,
  generation_status, headline, description, services, cta_text, notes,
  preview_url, created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000001006'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'garage-veldhuis',
  'Garage Veldhuis', 'Autogarages', 'Groningen', 'business_standard',
  'ready', 'completed', 'Uw auto in vertrouwde handen',
  'Garage Veldhuis verzorgt onderhoud, reparaties en APK-keuringen in Groningen. Persoonlijk, eerlijk en altijd met een duidelijke prijsopgave.', array['Onderhoud en reparatie', 'APK-keuring', 'Bandenservice', 'Airco-service']::text[], 'Plan direct een afspraak', '',
  '/demo/garage-veldhuis', '2026-09-10T12:30:00.000Z', '2026-09-13T10:08:00.000Z'
);

insert into public.demo_websites (
  id, lead_id, slug, business_name, industry, city, template, status,
  generation_status, headline, description, services, cta_text, notes,
  preview_url, created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000001007'::uuid, '00000000-0000-4000-8000-000000000011'::uuid, 'wolters-schilders',
  'Wolters Schilders', 'Schilders', 'Haarlem', 'home_improvement',
  'failed', 'failed', 'Vakwerk voor iedere wand en gevel',
  'Wolters Schilders verzorgt binnen- en buitenschilderwerk in Haarlem en omstreken. Snel, netjes en met hoogwaardige materialen.', array['Binnenschilderwerk', 'Buitschilderwerk', 'Kozijnen', 'Behangwerk']::text[], 'Vraag een gratis kleuradvies aan', 'Generatie mislukt — opnieuw proberen in latere fase.',
  '/demo/wolters-schilders', '2026-09-11T16:20:00.000Z', '2026-09-13T09:40:00.000Z'
);

insert into public.demo_websites (
  id, lead_id, slug, business_name, industry, city, template, status,
  generation_status, headline, description, services, cta_text, notes,
  preview_url, created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000001008'::uuid, '00000000-0000-4000-8000-000000000012'::uuid, 'de-roode-dakwerken',
  'De Roode Dakwerken', 'Dakwerken', 'Enschede', 'home_improvement',
  'ready', 'completed', 'Kwaliteitsdakwerk in Enschede en omstreken',
  'De Roode Dakwerken is met 200+ reviews een van de best beoordeelde dakdekkers van Overijssel. Nieuwe daken, renovatie en onderhoud.', array['Nieuwe daken', 'Dakrenovatie', 'Onderhoud en reparatie', 'Dakisolatie']::text[], 'Plan een gratis dakinspectie', '',
  '/demo/de-roode-dakwerken', '2026-09-06T18:05:00.000Z', '2026-09-14T08:20:00.000Z'
);
