/**
 * Genereert supabase/seed.sql uit de centrale mock data (lib/mock-data.ts +
 * lib/mock-demos.ts). Zo blijven mock data en seed altijd consistent.
 *
 * Uitvoeren: npx tsx scripts/generate-seed.ts
 * Vervolgens in Supabase: migration 0001_init.sql + deze seed.sql draaien.
 * Bevat uitsluitend fictieve bedrijven.
 */
import { writeFileSync } from "node:fs";
import { leads } from "../lib/mock-data";
import { demos } from "../lib/mock-demos";

/** Deterministische UUID per mock-id (ld-001, demo-001) — stabiel tussen runs. */
function leadUuid(id: string): string {
  const num = Number.parseInt(id.replace("ld-", ""), 10) || 0;
  return `00000000-0000-4000-8000-${String(num).padStart(12, "0")}`;
}

function demoUuid(id: string): string {
  const num = Number.parseInt(id.replace("demo-", ""), 10) || 0;
  return `00000000-0000-4000-8000-${String(1000 + num).padStart(12, "0")}`;
}

function q(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `array[${value.map((item) => q(item)).join(", ")}]::text[]`;
  if (typeof value === "object") return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

const leadRows = leads
  .map((lead) => {
    const aiSummary = lead.aiAnalysis ?? null;
    return `insert into public.leads (
  id, business_name, industry, address, postal_code, city, province, country,
  phone, email, website, website_status, google_rating, review_count,
  lead_score, lead_status, outreach_status, demo_status, source, notes, ai_summary,
  created_at, updated_at
) values (
  '${leadUuid(lead.id)}'::uuid, ${q(lead.businessName)}, ${q(lead.industry)}, ${q(lead.address)},
  ${q(lead.postalCode)}, ${q(lead.city)}, ${q(lead.province)}, ${q(lead.country)},
  ${q(lead.phone)}, ${q(lead.email)}, ${q(lead.website)}, ${q(lead.websiteStatus)},
  ${q(lead.googleRating)}, ${q(lead.reviewCount)}, ${q(lead.leadScore)},
  ${q(lead.leadStatus)}, ${q(lead.outreachStatus)}, ${q(lead.demoStatus)},
  ${q(lead.source)}, ${q(lead.notes)}, ${q(aiSummary)},
  ${q(lead.createdAt)}, ${q(lead.updatedAt)}
);`;
  })
  .join("\n\n");

const demoRows = demos
  .map((demo) => {
    return `insert into public.demo_websites (
  id, lead_id, slug, business_name, industry, city, template, status,
  generation_status, headline, description, services, cta_text, notes,
  preview_url, created_at, updated_at
) values (
  '${demoUuid(demo.id)}'::uuid, '${leadUuid(demo.leadId)}'::uuid, ${q(demo.slug)},
  ${q(demo.businessName)}, ${q(demo.industry)}, ${q(demo.city)}, ${q(demo.template)},
  ${q(demo.status)}, ${q(demo.generationStatus)}, ${q(demo.headline)},
  ${q(demo.description)}, ${q(demo.services)}, ${q(demo.ctaText)}, ${q(demo.notes)},
  ${q(demo.previewUrl)}, ${q(demo.createdAt)}, ${q(demo.updatedAt)}
);`;
  })
  .join("\n\n");

const output = `-- ============================================================
-- Silvijn Studio AI — seed data (gegenereerd door scripts/generate-seed.ts)
-- Uitsluitend FICTIEVE bedrijven. Draai eerst supabase/migrations/0001_init.sql.
-- ============================================================

${leadRows}

${demoRows}
`;

writeFileSync("supabase/seed.sql", output);
console.info(`supabase/seed.sql gegenereerd: ${leads.length} leads, ${demos.length} demo's`);
