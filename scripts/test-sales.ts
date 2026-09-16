/**
 * Sales-testsuite (Fase 7) — draait in mock mode (AI_MODE=mock default):
 * geen enkele echte API-call, geen enkele verzending. Alle 10 vereiste
 * inbound-scenario's gaan door de volledige pipeline.
 * Uitvoeren: npx tsx scripts/test-sales.ts
 */
import { SalesAnalysisSchema } from "../lib/ai/schemas";
import { getAIConfig } from "../lib/ai/config";
import { classifyMockInbound } from "../lib/sales/mock-classification";
import { checkSalesResponseQuality } from "../lib/sales/quality-check";
import { SalesService, SalesNotFoundError } from "../lib/sales/service";
import { getInboundMessageRepository } from "../lib/sales/repository";
import { getLeadRepository } from "../lib/repositories/lead-repository";
import { MOCK_INBOUND_SCENARIOS } from "../lib/sales/mock-inbound";

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  console.info(`${condition ? "PASS" : "FAIL"} — ${name}${condition || !detail ? "" : ` (${detail})`}`);
  if (!condition) failures += 1;
}

async function main() {
  console.info(`AI-mode: ${getAIConfig().mode} — sales-agent draait zonder Anthropic in mock mode`);

  const service = new SalesService();
  const leadRepo = getLeadRepository();

  // ---- 0) Zod-validatie ----
  check("Zod weigert ongeldige sales-output", !SalesAnalysisSchema.safeParse({ intent: "nonexistent", qualification: {}, response: "x" }).success);

  // ---- 1) Repository: inbound aanmaken + ophalen ----
  const lead = await leadRepo.get("ld-001");
  check("fictieve testlead beschikbaar", Boolean(lead));
  const message = await service.createInboundMessage({
    leadId: "ld-001",
    channel: "email",
    sender: "Jeroen Jansen (TESTDATA)",
    subject: "Interesse",
    body: "TESTDATA (mock): dit klinkt interessant, ik wil graag meer weten.",
    source: "manual",
  });
  check("inbound aangemaakt", Boolean(message.id));
  check("inbound via getById ophaalbaar", (await getInboundMessageRepository().getById(message.id))?.id === message.id);
  const inboundByLead = await service.listInboundByLead("ld-001");
  check("listByLead werkt", inboundByLead.length >= 1);
  let emptyBodyError = "";
  try { await service.createInboundMessage({ leadId: "ld-001", channel: "email", sender: "x", subject: "", body: "  ", source: "manual" }); } catch (e) { emptyBodyError = e instanceof Error ? e.message : ""; }
  check("lege berichttekst geweigerd", emptyBodyError.includes("ontbreekt"));
  let unknownLeadError = "";
  try { await service.createInboundMessage({ leadId: "ld-999", channel: "email", sender: "x", subject: "x", body: "x", source: "manual" }); } catch (e) { unknownLeadError = e instanceof Error ? e.message : ""; }
  check("onbekende lead geweigerd", unknownLeadError.length > 0);

  // ---- 2) Volledige analyse via de pipeline (mock AI) ----
  const analysis = await new SalesService().analyzeInboundMessage("ld-001", message.id);
  check("analyse voltooid", Boolean(analysis.interaction));
  check("kwalificatie aanwezig", analysis.interaction.qualification.status.length > 0);
  check("antwoord-concept aanwezig", analysis.interaction.responseDraft.length >= 50);
  check("vervolgvragen max 3 (schema)", analysis.interaction.questions.length <= 3);
  check("quality check geslaagd in mock", analysis.qualityPassed, analysis.interaction.qualityIssues.join("; "));
  check("geen prijs in antwoord-concept", !/€\s?\d+|\b\d+\s?euro\b/i.test(analysis.interaction.responseDraft));

  // ---- 3) Alle 10 vereiste mock-scenario's door de volledige pipeline ----
  const leadIds = ["ld-002", "ld-003", "ld-004", "ld-005", "ld-006", "ld-007", "ld-008", "ld-009", "ld-010", "ld-011"];
  const expectedIntents = [
    "interested", "price_request", "demo_request", "not_interested",
    "objection", "not_now", "unclear", "call_request", "opt_out", "more_information",
  ];

  for (let i = 0; i < MOCK_INBOUND_SCENARIOS.length; i++) {
    const scenario = MOCK_INBOUND_SCENARIOS[i];
    const leadId = leadIds[i];
    const exists = await leadRepo.get(leadId);
    check(`scenario "${scenario.label}" lead bestaat (${leadId})`, Boolean(exists));
    if (!exists) continue;

    const inboundMessage = await service.createInboundMessage({
      leadId,
      channel: "email",
      sender: scenario.sender,
      subject: scenario.subject,
      body: scenario.body,
      source: "manual",
    });
    const result = await new SalesService().analyzeInboundMessage(leadId, inboundMessage.id);
    const expected = expectedIntents[i];
    check(`scenario ${i + 1} (${scenario.label}): intent=${expected}`,
      result.interaction.intent === expected,
      `gekregen: ${result.interaction.intent}`);
  }

  // ---- 4) Escalatieregels ----
  const interactions = await service.listAllInteractions();
  const priceInteraction = interactions.find((i) => i.intent === "price_request");
  check("prijsaanvraag → escalatie (READY FOR SILVIJN)", priceInteraction?.escalationRequired === true && priceInteraction?.status === "ready_for_silvijn");
  check("prijsaanvraag → escalatiereden gevuld", (priceInteraction?.escalationReason ?? "").length > 10, priceInteraction?.escalationReason ?? "");
  const customInteraction = interactions.find((i) => i.intent === "more_information" && i.escalationRequired);
  check("complexe/custom aanvraag → escalatie", Boolean(customInteraction));
  const unclearInteraction = interactions.find((i) => i.intent === "unclear");
  check("onduidelijke reactie → NEEDS_HUMAN + escalatie", unclearInteraction?.qualification.status === "needs_human" && unclearInteraction?.escalationRequired === true);

  // ---- 5) Lead-statussync (conservatieve regels) ----
  const interestedLead = await leadRepo.get("ld-002");
  check("geen downgrade: qualified-lead blijft qualified", interestedLead?.leadStatus === "qualified", interestedLead?.leadStatus);
  const upgradedLead = await leadRepo.get("ld-009"); // start als 'new', scenario: call request
  check("positieve interesse op nieuwe lead → leadStatus=interested", upgradedLead?.leadStatus === "interested", upgradedLead?.leadStatus);
  const optOutLead = await leadRepo.get("ld-010");
  check("opt-out → outreachStatus=opted_out", optOutLead?.outreachStatus === "opted_out", optOutLead?.outreachStatus);
  const notInterestedLead = await leadRepo.get("ld-005");
  check("niet geïnteresseerd → géén lost-status", notInterestedLead?.leadStatus !== "lost", notInterestedLead?.leadStatus);

  // ---- 6) Interactie-statusupdates ----
  const firstInteraction = interactions[0];
  if (firstInteraction) {
    const marked = await new SalesService().markReadyForSilvijn(firstInteraction.id);
    check("Mark Ready for Silvijn werkt", marked.status === "ready_for_silvijn");
    const handled = await new SalesService().markHandled(firstInteraction.id);
    check("Markeer afgehandeld werkt", handled.status === "handled");
    let notFound = "";
    try { await new SalesService().markReadyForSilvijn("sint-999"); } catch (e) { notFound = e instanceof Error ? e.name : ""; }
    check("onbekende interactie faalt netjes", notFound === SalesNotFoundError.name, notFound);
  }

  // ---- 7) Safety-limiet ----
  process.env.MAX_SALES_ANALYSES_PER_RUN = "1";
  const limited = new SalesService();
  const limitLead = await leadRepo.get("ld-012");
  if (limitLead) {
    const limitInbound = await limited.createInboundMessage({ leadId: "ld-012", channel: "email", sender: "T (TESTDATA)", subject: "test", body: "TESTDATA (mock): test", source: "manual" });
    await limited.analyzeInboundMessage("ld-012", limitInbound.id);
    const second = await limited.createInboundMessage({ leadId: "ld-012", channel: "email", sender: "T (TESTDATA)", subject: "test 2", body: "TESTDATA (mock): tweede test", source: "manual" });
    let limitError = "";
    try { await limited.analyzeInboundMessage("ld-012", second.id); } catch (e) { limitError = e instanceof Error ? e.name : ""; }
    check("sales-analyse-limiet weigert tweede call", limitError === "SalesLimitError", limitError);
  }
  delete process.env.MAX_SALES_ANALYSES_PER_RUN;

  // ---- 8) Bericht van andere lead kan niet worden geanalyseerd ----
  let crossError = "";
  try { await new SalesService().analyzeInboundMessage("ld-001", "inb-999"); } catch (e) { crossError = e instanceof Error ? e.name : ""; }
  check("bericht van andere lead geweigerd", crossError === SalesNotFoundError.name, crossError);

  // ---- 9) Deterministische quality checks ----
  const base = { response: "TESTDATA (mock): een geldig antwoord-concept van voldoende lengte voor de klant van deze fictieve lead.", suggestedNextAction: "TESTDATA (mock): volg menselijk op" };
  check("te kort antwoord geweigerd", !checkSalesResponseQuality({ response: "kort", suggestedNextAction: "ok actie" }, { allowMockMarkers: true }).passed);
  check("prijs in antwoord geweigerd", !checkSalesResponseQuality({ response: "TESTDATA (mock): dit kost 500 euro voor uw website — geldig antwoord van voldoende lengte.", suggestedNextAction: base.suggestedNextAction }, { allowMockMarkers: true }).passed);
  check("korting geweigerd", !checkSalesResponseQuality({ response: "TESTDATA (mock): we geven u graag korting op deze fictieve opdracht van voldoende lengte.", suggestedNextAction: base.suggestedNextAction }, { allowMockMarkers: true }).passed);
  check("garantie geweigerd", !checkSalesResponseQuality({ response: "TESTDATA (mock): wij geven garantie op het resultaat van deze fictieve opdracht, lang genoeg.", suggestedNextAction: base.suggestedNextAction }, { allowMockMarkers: true }).passed);
  check("contracttermen geweigerd", !checkSalesResponseQuality({ response: "TESTDATA (mock): wij sturen u graag een contract met algemene voorwaarden toe, voldoende lang.", suggestedNextAction: base.suggestedNextAction }, { allowMockMarkers: true }).passed);
  check("placeholder geweigerd", !checkSalesResponseQuality({ response: "TESTDATA (mock): beste {{naam}}, {{bedrijf}} — voldoende lengte voor deze controle.", suggestedNextAction: base.suggestedNextAction }, { allowMockMarkers: true }).passed);
  check("interne info geweigerd", !checkSalesResponseQuality({ response: "TESTDATA (mock): onze sk-ant-abc key zie je niet — dit is een antwoord van voldoende lengte.", suggestedNextAction: base.suggestedNextAction }, { allowMockMarkers: true }).passed);
  check("TESTDATA geweigerd in live mode", !checkSalesResponseQuality(base).passed);
  check("TESTDATA toegestaan in mock mode", checkSalesResponseQuality(base, { allowMockMarkers: true }).passed);

  // ---- 10) Mock-classificatie-eenheden ----
  check("classificatie: interested", classifyMockInbound("dit klinkt goed, heeft interesse", "").intent === "interested");
  check("classificatie: opt_out heeft prioriteit boven interessanter", classifyMockInbound("interessant maar ik wil geen e-mails meer", "").intent === "opt_out");
  check("classificatie: unclear bij nietszeggende tekst", classifyMockInbound("zoiets ja", "hm").intent === "unclear");

  console.info(failures === 0 ? "\\nALLE SALES-TESTS PASS" : `\\n${failures} TEST(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.info(`Onverwachte fout: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
