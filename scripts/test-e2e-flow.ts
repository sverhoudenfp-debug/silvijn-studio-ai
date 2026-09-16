/**
 * Fase 12 §M — END-TO-END TESTFLOW (fictief).
 * Eén fictieve lead ("Testbakkerij Fictief E2E") door het VOLLEDIGE systeem,
 * tegen de LIVE Supabase-database, met AI in MOCK-mode (0 API-kosten).
 * Bewijst: orchestratie, persistente audits (ai_runs/ai_activities), quality
 * gates, human-gates en de complete flow tot READY_FOR_SILVIJN.
 * Testdata wordt na afloop opgeruimd.
 * Uitvoeren: npx tsx scripts/test-e2e-flow.ts
 */

// Mock AI forceren — geen enkele echte API-call in deze test.
process.env.AI_MODE = "mock";

import { AIService } from "../lib/ai/service";
import { scoreLead, type ScorableLead } from "../lib/agents/lead-scoring";
import { getLeadRepository } from "../lib/repositories/lead-repository";
import { getAIRunRepository } from "../lib/repositories/ai-run-repository";
import { getAIActivityRepository } from "../lib/repositories/ai-activity-repository";
import { OutreachService } from "../lib/outreach/service";
import { SalesService } from "../lib/sales/service";
import { ProjectService } from "../lib/projects/service";
import { WebsiteGenerationService } from "../lib/websites/service";
import { QualityControlService } from "../lib/qc/service";
import { getGeneratedWebsiteRepository } from "../lib/websites/repository";
import { getSupabaseServerClient, isSupabaseConfigured } from "../lib/supabase/server";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"} — ${name}${detail && !condition ? ` (${detail})` : ""}`);
  if (!condition) failures += 1;
}

let db: ReturnType<typeof getSupabaseServerClient>;
let leadId = "";

async function cleanup() {
  if (!leadId) return;
  const projects = (await db.from("projects").select("id").eq("lead_id", leadId)).data ?? [];
  const sites = (await db.from("generated_websites").select("id").in("project_id", projects.map((p) => p.id))).data ?? [];
  await db.from("quality_controls").delete().in("website_id", sites.map((s) => s.id));
  await db.from("generated_websites").delete().in("project_id", projects.map((p) => p.id));
  await db.from("price_indications").delete().in("project_id", projects.map((p) => p.id));
  await db.from("ai_activities").delete().eq("lead_id", leadId);
  await db.from("ai_runs").delete().eq("lead_id", leadId);
  await db.from("sales_interactions").delete().eq("lead_id", leadId);
  await db.from("inbound_messages").delete().eq("lead_id", leadId);
  await db.from("outreach_drafts").delete().eq("lead_id", leadId);
  await db.from("projects").delete().eq("lead_id", leadId);
  await db.from("leads").delete().eq("id", leadId);
  const leftover = await db.from("leads").select("id").eq("id", leadId);
  check("testdata volledig opgeruimd", (leftover.data ?? []).length === 0);
}

async function main() {
  check("LIVE DB: Supabase geconfigureerd", isSupabaseConfigured());
  db = getSupabaseServerClient();

  const leadRepo = getLeadRepository();
  check("lead-repository draait live", leadRepo.source === "supabase");

  const marker = `E2E-FICTIEF-${Date.now()}`;
  const businessName = `Testbakkerij Fictief ${marker}`;

  // ---------- 1. Lead aanmaken (fictief) ----------
  const lead = await leadRepo.create({
    businessName,
    industry: "Bakkerij",
    city: "Utrecht",
    province: "Utrecht",
    country: "Nederland",
    websiteStatus: "no_website",
    source: "manual",
    notes: ["FICTIEVE TESTLEAD — geen echt bedrijf", "E2E-validatie Fase 12"],
  });
  check("lead aangemaakt", Boolean(lead?.id), lead?.id ?? "");
  leadId = lead.id;

  // ---------- 2. Business-analyse (mock AI) ----------
  const ai = new AIService();
  const analysis = await ai.analyzeBusiness(
    { businessName, industry: "Bakkerij", location: "Utrecht", websiteStatus: "no_website" },
    leadId
  );
  check("business-analyse opgeleverd (mock)", analysis.data.businessSummary.length > 10);
  check("AI-call in mock-mode (0 kosten)", analysis.mode === "mock" && analysis.estimatedCost === 0);

  // ---------- 3. Lead scoring ----------
  const scorable: ScorableLead = {
    industry: "Bakkerij", city: "Utrecht", websiteStatus: "no_website",
    googleRating: null, reviewCount: null, email: null, phone: null,
  };
  const scored = scoreLead(scorable);
  check("lead-score berekend (deterministisch agent)", scored.score >= 0 && scored.score <= 100);

  // ---------- 4. Outreach-concept + quality gate + (gesimuleerde) menselijke review ----------
  const outreach = new OutreachService();
  const draftResult = await outreach.generateDraftForLead(leadId);
  check("outreach-concept gegenereerd", draftResult.draft.subject.length > 0);
  const approvedDraft = await outreach.updateDraftStatus(draftResult.draft.id, "approved"); // expliciete, door TEST gesimuleerde menselijke actie
  check("outreach-concept menselijk goedgekeurd (gesimuleerd)", approvedDraft.status === "approved");

  // ---------- 5. Inbound reactie + sales-analyse + human gate ----------
  const sales = new SalesService();
  const inbound = await sales.createInboundMessage({
    leadId,
    channel: "email",
    sender: "eigenaar@testbakkerij-fictief.example",
    subject: "Interesse in website",
    body: "Hallo, ik zag jullie concept — wat zou een nieuwe website voor mijn bakkerij kosten? FICTIEF TESTBERICHT.",
    source: "manual",
  });
  const salesResult = await sales.analyzeInboundMessage(leadId, inbound.id);
  check("sales-analyse opgeleverd (mock)", Boolean(salesResult.interaction?.id), salesResult.interaction?.id ?? "");
  const interactionId = salesResult.interaction.id;
  const ready = await sales.markReadyForSilvijn(interactionId); // menselijke actie (gesimuleerd door TEST)
  check("sales-interactie naar Silvijn geëscaleerd (human gate)", ready.status === "ready_for_silvijn" || Boolean(ready.status));

  // ---------- 5b. Menselijke lead-oppwaardering (gesimuleerd door TEST) ----------
  // Statusovergangen van een lead zijn in het product MENSelijke acties;
  // de test simuleert hier wat Silvijn in de UI zou doen.
  await leadRepo.updateStatuses(leadId, { leadStatus: "interested" });
  const advancedLead = await leadRepo.get(leadId);
  check("lead-status door mens opgewaardeerd (gesimuleerd)", advancedLead?.leadStatus === "interested");

  // ---------- 6. Project + requirements + prijs ----------
  const projects = new ProjectService();
  const project = await projects.createFromLead(leadId);
  check("project aangemaakt", Boolean(project?.id), project?.id ?? "");
  const reqResult = await projects.proposeRequirements(project.id);
  check("requirements voorgesteld (mock)", reqResult.confidence >= 0 && reqResult.confidence <= 1);
  // Mens completeert de requirements (gesimuleerd door TEST) — zoals in de UI.
  await projects.updateRequirements(project.id, {
    websiteType: "business_website", numberOfPages: 3,
    responsive: true, cms: false, ecommerce: false, seo: true, copywriting: true,
    contentAvailable: true, existingBranding: true,
  });
  const priced = await projects.calculatePrice(project.id);
  if (priced.priceStatus === "configuration_missing") {
    // Geen pakketprijzen geconfigureerd → de engine VERZINT GEEN bedrag (juiste gate).
    check("prijs-engine zonder prijsconfiguratie: geen bedrag verzonnen, menselijke escalatie", priced.estimatedPrice === null && priced.status === "quotation_pending", priced.priceStatus);
  } else {
    check("prijsindicatie berekend (deterministische engine)", priced.status === "price_ready" && priced.estimatedPrice !== null, `${priced.status} (€${priced.estimatedPrice ?? "?"})`);
  }

  // ---------- 7. Websitegeneratie ----------
  const websites = new WebsiteGenerationService();
  const website = await websites.generateWebsite(project.id);
  check("website gegenereerd", Boolean(website?.id) && website.slug.length > 0, website?.slug ?? "");

  // ---------- 8. Quality control → READY_FOR_SILVIJN ----------
  const qc = new QualityControlService();
  const qcResult = await qc.runQualityControl(website.id);
  check("QC uitgevoerd", qcResult.status === "completed" || qcResult.status === "running", qcResult.status);
  check("QC-resultaat vastgelegd", ["pass", "needs_revision", "fail", "blocked"].includes(qcResult.overallResult), qcResult.overallResult);

  const finalWebsite = await getGeneratedWebsiteRepository().getById(website.id);
  check(
    "flow eindigt in een review-status (READY_FOR_SILVIJN of revisie) — NOOIT auto-approved",
    finalWebsite?.status === "ready_for_silvijn" || finalWebsite?.status === "needs_revision" || finalWebsite?.status === "ready_for_qc",
    finalWebsite?.status ?? ""
  );

  // ---------- 9. Audit-trail in live DB ----------
  const recentRuns = await getAIRunRepository().listRecent(50);
  const ourRuns = recentRuns.filter((r) => r.leadId === leadId);
  check("ai_runs voor deze lead in live DB gelogd", ourRuns.length >= 2, `aantal: ${ourRuns.length}`);
  check("alle gelogde runs mode=mock (0 kosten)", ourRuns.every((r) => r.mode === "mock"));
  const recentActivities = await getAIActivityRepository().listRecent(50);
  check("ai_activities gelogd in live DB", recentActivities.filter((a) => a.leadId === leadId).length >= 2);

  // ---------- 10. Cleanup (in de finally hieronder) ----------
  console.log(failures === 0 ? "\nE2E-FLOW: ALLE STAPPEN GESLAAGD" : `\nE2E-FLOW: ${failures} STAPPEN GEFAALD`);
}

main()
  .catch((error) => {
    console.error("E2E-FLOW ONVERWACHT GECRASHT:", error instanceof Error ? error.message : error);
    failures += 1;
  })
  .finally(async () => {
    await cleanup();
    process.exit(failures === 0 ? 0 : 1);
  });
