/**
 * W9: per-pagina intro's, geschreven door de AI op basis van de briefing.
 *
 * Doel: elke pagina een eigen introductie geven (Over ons, Diensten, FAQ,
 * Contact) zonder verzonnen feiten en zonder contactkanalen die niet zijn
 * aangeleverd. De uitkomst wordt als `subheadline`-unit in het contentplan
 * gezet; de generator gebruikt hem als paginakop-intro.
 *
 *   npx tsx scripts/visual/page-intros.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { veldEnVormBrief } from "./veld-en-vorm-brief";

const PLAN = join(process.cwd(), "visual-output/veld-en-vorm/plans/content-plan.json");

const brief = veldEnVormBrief;
const facts = [
  `Bedrijf: ${brief.businessName}`,
  `Branche: ${brief.industry}`,
  `Plaats: ${brief.city}`,
  `Sinds: ${brief.founded}`,
  `Team: ${brief.teamSize} mensen`,
  `Positionering: ${brief.positioning}`,
  `Beloftes: ${brief.promise}`,
  `Diensten: ${brief.services.map((service) => service.title).join(", ")}`,
  `Werkgebied: ${brief.serviceArea.join(", ")}`,
  `Doelgroep: ${brief.audience}`,
  `Onderscheidend: ${brief.differentiators.join(" ")}`,
  `Werkwijze: ${brief.process.join(" ")}`,
].join("\n");

const PAGES: { key: string; instruction: string }[] = [
  { key: "over-ons", instruction: "Introduceer het verhaal en de werkwijze van het bedrijf: wie ze zijn, sinds wanneer, hoe ze werken." },
  { key: "diensten", instruction: "Introduceer het dienstenaanbod: wat ze doen en hoe ontwerp, aanleg, beplanting en onderhoud samenhangen." },
  { key: "faq", instruction: "Introduceer de vragen en antwoorden: wat bezoekers hier kunnen verwachten en waarom die vragen belangrijk zijn." },
  { key: "contact", instruction: "Help de bezoeker contact op te nemen: wat er gebeurt na een bericht en welke informatie helpt." },
];

async function writeIntro(page: { key: string; instruction: string }): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 300,

      system:
        "Je schrijft Nederlandse websitecopy voor een hoveniersbedrijf. Je gebruikt uitsluitend de aangeleverde feiten. " +
        "Verzin niets: geen prijzen, geen jaartallen, geen projecten, geen contactgegevens, geen telefoon of e-mail. " +
        "Geen verkooptaal of superlatieven. Je schrijft één introductie van 22 tot 32 woorden, in de u-vorm, zonder kop en zonder aanhalingstekens.",
      messages: [
        {
          role: "user",
          content: `Feiten:\n${facts}\n\nPagina: ${page.key}\nOpdracht: ${page.instruction}\n\nSchrijf alleen de introductie.`,
        },
      ],
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Anthropic HTTP ${response.status}: ${detail.slice(0, 240)}`);
  }
  const payload = (await response.json()) as { content?: Array<{ text?: string }> };
  const text = payload.content?.map((part) => part.text ?? "").join(" ").trim() ?? "";
  return text.replace(/^["“]|["”]$/g, "").replace(/\s+/g, " ");
}

(async () => {
  const plan = JSON.parse(readFileSync(PLAN, "utf8")) as {
    pages: { key: string; units: { path: string; kind: string; text?: string; status?: string; evidence?: string[]; claim?: string }[] }[];
  };
  for (const page of PAGES) {
    const entry = plan.pages.find((candidate) => candidate.key === page.key);
    if (!entry) continue;
    const existing = entry.units.find((unit) => unit.path === `${page.key}/0` && unit.kind === "subheadline");
    if (existing?.text && existing.text.length > 20) {
      console.log(page.key, "| bestaande intro behouden");
      continue;
    }
    const text = await writeIntro(page);
    if (/\b(telefoon|e-?mail|bel ons)\b/i.test(text) || text.length < 15) {
      console.log(page.key, "| intro afgekeurd:", text.slice(0, 80));
      continue;
    }
    if (existing) {
      existing.text = text;
    } else {
      entry.units.unshift({ path: `${page.key}/0`, kind: "subheadline", text, status: "generated", evidence: [brief.promise], claim: "F" });
    }
    console.log(page.key, "|", text);
  }
  writeFileSync(PLAN, JSON.stringify(plan, null, 2));
  console.log("plan bijgewerkt");
})();
