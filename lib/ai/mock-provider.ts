import { classifyMockInbound } from "@/lib/sales/mock-classification";
import type {
  AIProvider,
  AIProviderRequest,
  AIProviderResult,
} from "./types";

/**
 * Mock-provider — voorspelbare output, geen API-kosten. Wordt gebruikt wanneer
 * AI_MODE=mock (default). Gestructureerde taken krijgen geldige JSON zodat de
 * volledige validatie-pipeline ook in mock mode wordt getest.
 */

const mockBusinessAnalysis = `{
  "businessSummary": "Een gevestigd lokaal bedrijf met een sterke reputatie in de regio en een trouwe klantenkring.",
  "opportunity": "Het bedrijf mist een professionele webpresence; een moderne website kan direct nieuwe klanten opleveren.",
  "potentialProblems": "Zonder website is het bedrijf onvindbaar voor klanten die online zoeken; concurrenten met een website winnen marktaandeel.",
  "recommendedApproach": "Benader de eigenaar persoonlijk met een concrete demo-website die zijn diensten direct in beeld brengt."
}`;

const mockOutreachMessage = `{
  "personalizationReason": "TESTDATA (mock): \${BUSINESS_TOKEN} heeft op basis van de beschikbare leaddata momenteel geen eigen website, terwijl de lokale reputatie sterk is.",
  "approach": "TESTDATA (mock): korte, concrete introductie met verwijzing naar de beperkte online aanwezigheid en een voorbeeldwebsite.",
  "subject": "Voorbeeldwebsite voor \${BUSINESS_TOKEN}",
  "body": "Hallo,\\n\\nTESTDATA (mock): ik kwam \${BUSINESS_TOKEN} tegen bij het bekijken van \${CITY_TOKEN}-bedrijven in de \${INDUSTRY_TOKEN}. Wat opviel: jullie online aanwezigheid is momenteel beperkt, terwijl een website juist kan helpen om nieuwe klanten uit de regio aan te trekken.\\n\\nOm concreet te maken wat ik bedoel, heb ik vrijblijvend een voorbeeldwebsite opgesteld op basis van jullie bedrijf. Bekijk gerust of de stijl en invulling bij jullie past — volledig zonder verplichtingen.\\n\\nHartelijke groet,\\nSilvijn Studio",
  "callToAction": "TESTDATA (mock): bekijk de voorbeeldwebsite en reageer als je interesse heeft."
}`;

const mockSalesAnalysis = `{
  "intent": "\${INTENT_TOKEN}",
  "objectionType": "\${OBJECTION_TOKEN}",
  "qualification": {
    "status": "\${QUAL_STATUS_TOKEN}",
    "interestLevel": "\${INTEREST_TOKEN}",
    "projectType": null,
    "needsWebsite": \${NEEDS_WEB_TOKEN},
    "needsEcommerce": false,
    "wantsDemo": \${WANTS_DEMO_TOKEN},
    "wantsCall": \${WANTS_CALL_TOKEN},
    "timeline": null,
    "budgetKnown": false,
    "decisionMakerKnown": false,
    "requirementsKnown": false,
    "missingInformation": ["TESTDATA (mock): aanvullende projectinformatie is nog niet bekend."],
    "qualificationNotes": "TESTDATA (mock): classificatie op basis van de inkomende reactie; aanvullende informatie is nog nodig voor volledige kwalificatie.",
    "confidence": 0.6
  },
  "response": "TESTDATA (mock): dank voor uw reactie. Op basis van uw bericht wil ik graag kort terugkomen op uw vraag. Om u gericht verder te helpen, heb ik nog wat aanvullende informatie nodig over wat u precies zoekt. Vervolgens kan ik u een passend voorstel voorbereiden. Hartelijke groet, Silvijn Studio",
  "suggestedNextAction": "TESTDATA (mock): verzamel aanvullende informatie en bereid een menselijke opvolging voor.",
  "questions": ["TESTDATA (mock): Wat voor soort website zoekt u?", "TESTDATA (mock): Wanneer wilt u de website ongeveer online hebben?"],
  "escalationRequired": \${ESCALATION_TOKEN},
  "escalationReason": \${ESCALATION_REASON_TOKEN}
}`;

function buildMockSalesAnalysis(prompt: string): string {
  // Inbound-bericht uit de prompt halen (onder de Body:-marker, tot de lege regel)
  const match = prompt.match(/Body:\n([\s\S]*?)\n\n/);
  const subjectMatch = prompt.match(/Onderwerp: (.+)/);
  const inboundBody = match?.[1] ?? "";
  const inboundSubject = subjectMatch?.[1] ?? "";
  const c = classifyMockInbound(inboundBody, inboundSubject);

  const negative = c.intent === "opt_out" || c.intent === "not_interested" || c.intent === "wrong_contact";
  const qualStatus = negative
    ? "not_qualified"
    : c.intent === "unclear"
      ? "needs_human"
      : "qualifying";
  const interest = negative ? "none" : c.interestLevel;

  return mockSalesAnalysis
    .replaceAll("${INTENT_TOKEN}", c.intent)
    .replaceAll("${OBJECTION_TOKEN}", c.objectionType)
    .replaceAll("${QUAL_STATUS_TOKEN}", qualStatus)
    .replaceAll("${INTEREST_TOKEN}", interest)
    .replaceAll("${NEEDS_WEB_TOKEN}", negative ? "false" : "true")
    .replaceAll("${WANTS_DEMO_TOKEN}", c.intent === "demo_request" ? "true" : "false")
    .replaceAll("${WANTS_CALL_TOKEN}", c.intent === "call_request" ? "true" : "false")
    .replaceAll("${ESCALATION_TOKEN}", String(c.escalationRequired))
    .replaceAll("${ESCALATION_REASON_TOKEN}", JSON.stringify(c.escalationReason ?? null));
}

export class MockAIProvider implements AIProvider {
  readonly id = "mock";
  readonly mode = "mock" as const;

  async generateText(request: AIProviderRequest): Promise<AIProviderResult> {
    await new Promise((resolve) => setTimeout(resolve, 10));

    const businessToken = request.prompt.match(/Bedrijf: (.+)/)?.[1]?.split("\n")[0] ?? "het bedrijf";
    const cityToken = request.prompt.match(/Stad: (.+)/)?.[1]?.split("\n")[0] ?? "de regio";
    const industryToken = request.prompt.match(/Branche: (.+)/)?.[1]?.split("\n")[0] ?? "branche";

    const text =
      request.task === "business_analysis"
        ? mockBusinessAnalysis
        : request.task === "outreach_generation"
          ? mockOutreachMessage
            .replaceAll("\${BUSINESS_TOKEN}", businessToken)
            .replaceAll("\${CITY_TOKEN}", cityToken)
            .replaceAll("\${INDUSTRY_TOKEN}", industryToken)
          : request.task === "sales_analysis"
            ? buildMockSalesAnalysis(request.prompt)
            : `[MOCK AI] Antwoord op: ${request.prompt.slice(0, 80)}...`;

    return {
      text,
      model: `${request.model} (mock)`,
      mode: "mock",
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
