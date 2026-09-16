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
          : `[MOCK AI] Antwoord op: ${request.prompt.slice(0, 80)}...`;

    return {
      text,
      model: `${request.model} (mock)`,
      mode: "mock",
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
