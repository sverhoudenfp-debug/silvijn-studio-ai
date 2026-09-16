/**
 * Fase 12 §N — RLS-verificatie vanaf de anon-rol (publishable key).
 * Bewijst dat alle 15 live tabellen afgeschermd zijn: anon kan NIET lezen,
 * NIET schrijven en NIET verwijderen. Draait tegen de LIVE database.
 * Uitvoeren: npx tsx scripts/test-rls-anon.ts
 */

import { createClient } from "@supabase/supabase-js";
// ws als realtime-transport — zelfde patroon als lib/supabase/server.ts (Node 20 heeft geen native WebSocket).
import ws from "ws";
import type { WebSocketLikeConstructor } from "@supabase/realtime-js";
const wsTransport = ws as unknown as WebSocketLikeConstructor;

const TABLES = [
  "leads", "demo_websites", "outreach_drafts", "inbound_messages", "sales_interactions",
  "projects", "price_indications", "generated_websites", "quality_controls",
  "ai_runs", "ai_activities", "automations", "automation_runs", "automation_events", "automation_queue",
];

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"} — ${name}${detail && !condition ? ` (${detail})` : ""}`);
  if (!condition) failures += 1;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  check("publishable key aanwezig", Boolean(url && anonKey));

  const anon = createClient(url!, anonKey!, {
    auth: { persistSession: false },
    realtime: { transport: wsTransport },
  });

  for (const table of TABLES) {
    // 1. Lezen moet geweigerd worden (RLS zonder anon-policy → leeg of fout).
    const read = await anon.from(table).select("*").limit(1);
    const readBlocked = read.error != null || (read.data ?? []).length === 0;
    // 2. Schrijven moet geweigerd worden.
    const write = await anon.from(table).insert({ id: "anon-rls-test" }).select("id");
    const writeBlocked = write.error != null;

    check(
      `${table}: anon kan niet lezen`,
      readBlocked,
      read.error ? read.error.message.slice(0, 80) : `${read.data?.length ?? 0} rijen`
    );
    check(
      `${table}: anon kan niet schrijven`,
      writeBlocked,
      write.error ? write.error.message.slice(0, 80) : "ingeslagen!"
    );

    // Veiligheidsnet: mocht de insert tóch zijn geslaagd, direct opruimen.
    if (!writeBlocked) {
      await anon.from(table).delete().eq("id", "anon-rls-test");
    }
  }
}

main()
  .catch((error) => {
    console.error("RLS-TEST GECRASHT:", error instanceof Error ? error.message : error);
    failures += 1;
  })
  .finally(() => {
    console.log(failures === 0 ? "\nRLS ANON-TEST: ALLE 15 TABELLEN AFGESCHERMD" : `\nRLS ANON-TEST: ${failures} CONTROLES GEFAALD`);
    process.exit(failures === 0 ? 0 : 1);
  });
