/**
 * Outreach-testsuite (Fase 6) — draait in mock mode (AI_MODE=mock default):
 * geen enkele echte API-call, geen enkele verzending. Loopt tegen de
 * fictieve leads uit de mock repository.
 * Uitvoeren: npx tsx scripts/test-outreach.ts
 */
import { OutreachMessageSchema } from "../lib/ai/schemas";
import { getAIConfig } from "../lib/ai/config";
import { getAIRunRepository, MemoryAIRunRepository } from "../lib/repositories/ai-run-repository";
import { getLeadRepository } from "../lib/repositories/lead-repository";
import { OutreachService } from "../lib/outreach/service";
import { checkOutreachQuality } from "../lib/outreach/quality-check";
import { getOutreachRepository } from "../lib/outreach/repository";

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  console.info(`${condition ? "PASS" : "FAIL"} — ${name}${condition || !detail ? "" : ` (${detail})`}`);
  if (!condition) failures += 1;
}

async function main() {
  const config = getAIConfig();
  console.info(`AI-mode: ${config.mode} — outreach werkt volledig zonder Anthropic in mock mode`);

  const leadRepo = getLeadRepository();
  const outreachRepo = getOutreachRepository();
  const service = new OutreachService();

  // Fictieve testlead met READY demo (mock data — geen echte bedrijven)
  const leadWithDemo = await leadRepo.get("ld-001"); // Jansen Dakwerken — demo ready
  check("fictieve testlead beschikbaar", Boolean(leadWithDemo));

  // 1) Mock outreach-generatie (volledige pipeline: AI → Zod → quality → draft)
  const generated = await service.generateDraftForLead("ld-001");
  check("outreach draft gegenereerd", Boolean(generated.draft));
  check("draft begint als draft/ready_for_review (nooit sent)", ["draft", "ready_for_review"].includes(generated.draft.status), generated.draft.status);
  check("kanaal is email", generated.draft.channel === "email");
  check("quality check geslaagd in mock", generated.qualityPassed, generated.draft.qualityIssues.join("; "));
  check("mock output bevat TESTDATA-markering", generated.draft.body.includes("TESTDATA") || generated.mode === "live");
  check("geen verzonnen contactpersoon in output", !/\\b(beste|geachte)\\s+(meneer|mevrouw|heer)\\s+[A-Z]/i.test(generated.draft.body));
  check("subject gevuld", generated.draft.subject.length >= 5);
  check("body heeft redelijke lengte", generated.draft.body.length >= 150);

  // 2) AI-run gelogd met kosten/duratie (bestaande logging-infra)
  const runRepo = getAIRunRepository();
  if (runRepo instanceof MemoryAIRunRepository) {
    const runs = runRepo.getRuns();
    check("AI-run gelogd", runs.length >= 1, `${runs.length} runs`);
    const outreachRun = runs.at(-1);
    check("run bevat agent/model/duratie", Boolean(outreachRun && outreachRun.model && typeof outreachRun.durationMs === "number"));
  }

  // 3) Zod-validatie van het schema
  check("Zod accepteert geldige output", OutreachMessageSchema.safeParse({
    personalizationReason: "Relevant omdat".repeat(3),
    approach: "Concrete aanpak",
    subject: "Voorbeeldwebsite voor Jansen Dakwerken",
    body: "Hallo,\\n\\nDit is een volledige geldige e-mailtekst voor de testcase van de outreach-engine.".repeat(2),
    callToAction: "Bekijk de voorbeeldwebsite",
  }).success);
  const invalidParse = OutreachMessageSchema.safeParse({ personalizationReason: "kort", approach: "x", subject: "", body: "te kort", callToAction: "x" });
  check("Zod weigert ongeldige output", !invalidParse.success);

  // 4) Repository: create → getById → listByLead → update
  const stored = await outreachRepo.getById(generated.draft.id);
  check("draft opgehaald via getById", Boolean(stored));
  const byLead = await outreachRepo.listByLead("ld-001");
  check("listByLead werkt", byLead.length >= 1);
  const approved = await service.updateDraftStatus(generated.draft.id, "approved");
  check("statusupdate naar approved", approved.status === "approved");
  const cancelled = await outreachRepo.update(generated.draft.id, { status: "cancelled" });
  check("cancel via repository", cancelled?.status === "cancelled");

  // 5) SENT kan niet worden gezet in Fase 6
  let sentError = "";
  try { await service.updateDraftStatus(generated.draft.id, "sent"); } catch (e) { sentError = e instanceof Error ? e.message : ""; }
  check("sent is geblokkeerd in Fase 6", sentError.includes("niet mogelijk in Fase 6"), sentError);

  // 6) Generatie-limiet per run
  const limited = new OutreachService();
  process.env.MAX_OUTREACH_GENERATIONS_PER_RUN = "1";
  await limited.generateDraftForLead("ld-002");
  let limitError = "";
  try { await limited.generateDraftForLead("ld-003"); } catch (e) { limitError = e instanceof Error ? e.name : ""; }
  check("generatie-limiet weigert tweede call", limitError === "OutreachGenerationLimitError", limitError);
  delete process.env.MAX_OUTREACH_GENERATIONS_PER_RUN;

  // 7) Onbekende lead
  let notFoundError = "";
  try { await new OutreachService().generateDraftForLead("ld-999"); } catch (e) { notFoundError = e instanceof Error ? e.name : ""; }
  check("onbekende lead faalt netjes", notFoundError === "OutreachNotFoundError");

  // 8) Lead ZONDER demo — prompt krijgt 'geen demo' mee; draft blijft geldig
  const leadIds = (await leadRepo.list()).map((l) => l.id);
  const leadWithoutDemoId = leadIds.find((id) => !["ld-001", "ld-002", "ld-011"].includes(id)) ?? "ld-006";
  const noDemoResult = await new OutreachService().generateDraftForLead(leadWithoutDemoId);
  check("generatie zonder demo werkt", Boolean(noDemoResult.draft));

  // 9) Quality checks — alle deterministische regels
  const base = { subject: "Voorbeeldwebsite", body: "x".repeat(200), callToAction: "Bekijk de demo website" };
  check("lege subject geweigerd", !checkOutreachQuality({ ...base, subject: "" }).passed);
  check("lege body geweigerd", !checkOutreachQuality({ ...base, body: "" }).passed);
  check("te korte body geweigerd", !checkOutreachQuality({ ...base, body: "kort" }).passed);
  check("placeholder geweigerd", !checkOutreachQuality({ ...base, body: "Beste {{naam}}, ".repeat(10) }).passed);
  check("verzonnen contactpersoon geweigerd", !checkOutreachQuality({ ...base, body: `Beste meneer Jansen, ${"x".repeat(200)}` }).passed);
  check("ongefundeerde claim geweigerd", !checkOutreachQuality({ ...base, body: `Jullie verliezen veel klanten via Google. ${"x".repeat(200)}` }).passed);
  check("AI-vermelding richting klant geweigerd", !checkOutreachQuality({ ...base, body: `Deze tekst is AI-gegenereerd. ${"x".repeat(200)}` }).passed);
  check("mock/testdata geweigerd", !checkOutreachQuality({ ...base, body: `Lorem ipsum mock tekst. ${"x".repeat(200)}` }).passed);
  check("interne info (api key patroon) geweigerd", !checkOutreachQuality({ ...base, body: `Onze sk-ant-abc123 moet je niet zien. ${"x".repeat(200)}` }).passed);
  check("geldige tekst goedgekeurd", checkOutreachQuality({ ...base, body: `${"Volledig geldige en persoonlijke outreach-tekst. ".repeat(5)}` }).passed);

  console.info(failures === 0 ? "\\nALLE OUTREACH-TESTS PASS" : `\\n${failures} TEST(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.info(`Onverwachte fout: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
