# Gmail-integratie — implementatieverslag (17 september 2026)

Onderdeel van de masterconfig-werkvolgorde (C: Gmail). Commit: zie git log;
migratie `0015_gmail_integration` is live toegepast en gecontroleerd.

## Wat er is gebouwd

- **OAuth 2.0-verbinding met het studio-account** (`silvijn@silvijnstudio.com`):
  geautoriseerde eigenaar start de flow via de settingspagina; state-cookie
  (CSRF) wordt in de callback geverifieerd; redirect-URI's zijn strikt
  allowlisted (`app.silvijnstudio.com`, `silvijn-studio-ai.vercel.app`,
  `localhost`). Scopes: `gmail.send` + `gmail.readonly`.
- **Refresh-tokenopslag**: AES-256-GCM-versleuteld in de nieuwe tabel
  `public.gmail_connections` (RLS aan; alleen de eigenaar leest). Sessietokens
  worden in-memory gehaald en pas bij 401 ververst.
- **Verzenden**: `GmailEmailProvider` (server-side) stuurt goedgekeurde
  outreach-concepten via de Gmail REST API, met eigen `Message-ID`
  (`<outreach-…@silvijnstudio.com>`) zodat antwoorden exact matchbaar zijn.
  `MockEmailProvider` blijft de default; `EMAIL_PROVIDER=gmail` schakelt
  expliciet over en faalt fail-loud zonder complete configuratie.
- **Ingestie (reply-only)**: beveiligde `/api/gmail/ingest` route + RPC
  `ingest_gmail_reply`. Matching: eerst In-Reply-To/References op verzonden
  berichten, daarna afzenderadres op `lead_contacts`/`leads.email`. Berichten
  van het studio-account zelf en volledig onbekende afzenders worden nooit
  gekoppeld. Idempotent op `(channel, account, provider_message_id)`.
- **Conversatie-activering** blijft uitsluitend aan echte reacties gekoppeld:
  koud verzonden outreach maakt geen gesprek; een echte reply activeert de
  bestaande conversation-record (migratie 0012-mechanisme, ongewijzigd).
- **UI**: Gmail-statuskaart op de settingspagina (verbinden/verbreken/sync),
  verzendknop per goedgekeurd concept op de outreach-pagina (alleen als Gmail
  geconfigureerd én verbonden is).

## Beveiliging

- Guard-amendement op `guard_message_identity`: een bevestigde reply kan
  voortaan op twee wegen — (a) de geverifieerde eigenaar in eigen persoon
  (`auth.uid()`), of (b) een provider-geverifieerde Gmail-reactie die bij een
  bestaande geautoriseerde verbinding van de eigenaar hoort. Alle overige
  wegen (inclusief mock/test-sources) blijven exact zoals in migratie 0012.
- `ingest_gmail_reply` is security-invoker, gepoliced, en vereist een echte
  `gmail_connections`-rij van de eigenaar voor `confirmed_by`; zonder
  verbinding: `NO_VERIFIED_GMAIL_CONNECTION`.
- Ingest-API vereist service-auth (service-role sleutel), geen publieke
  toegang; server actions vereisen `requireStudioOwner()` (gefilterd in
  tests). Synthetische sources kunnen nog steeds nooit een conversatie
  activeren.

## Verificatie (live, 17 september 2026)

- Migratie 0015 toegepast; **SQL-suite `scripts/test-gmail-integration.sql`
  (8 tests) PASS met rollback**: evidence-verplichting, self-reply-ignoring,
  conversatie-activering, idempotentie, bericht-conflict tussen leads,
  outreach-zonder-reactie maakt geen gesprek, reply-op-outreach activeert
  wél, synthetische-activering geblokkeerd, RLS-policy aanwezig.
- Alle 6 eerdere SQL-suites opnieuw PASS (fixtures geüpdatet: het
  eigenaarsaccount bestaat nu echt sinds de login-flow, suites hergebruiken
  het bestaande id binnen hun rollback-transactie).
- 43 applicatietests PASS (7 nieuw: OAuth-config/auth-url/state,
  token-versleuteling incl. manipulatie-detectie, provider-selectie,
  verzend-MIME, reply-matching), TypeScript strict, lint zonder
  waarschuwingen, productiebuild groen.
- Data-integriteit: 17 leads ongewijzigd; 0 conversations, 0
  gmail_connections (geen fixtures gepersisteerd).

## Wat er NIET werkt (eerlijk)

- Er is nog geen echte Gmail-verbinding: OAuth vereist
  `GMAIL_CLIENT_ID`/`GMAIL_CLIENT_SECRET`/`GMAIL_TOKEN_ENCRYPTION_KEY` in
  Vercel (nog niet ingesteld door Silvijn). Zonder deze keys is de
  functionaliteit in productie correct geblokkeerd
  (`BLOCKED_EXTERNAL_CONFIGURATION`), nooit stil mock.
- Pub/Sub-push (realtime ingestie) is niet geconfigureerd; sync is nu
  handmatig te triggeren (settings) of via de beveiligde API-route.
- Geen enkele echte outreach-mail is verzonden; er zijn nog geen echte
  prospectreacties opgeslagen. Inbox-scanning is pas bewezen na de eerste
  echte verbinding.
- Discovering/outreach-automatisering, discovery-orchestratie en de overige
  masterconfig-onderdelen (D, E, G-O) zijn onveranderd nog open.
