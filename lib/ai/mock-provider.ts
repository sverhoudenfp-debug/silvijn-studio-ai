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

export class MockAIProvider implements AIProvider {
  readonly id = "mock";
  readonly mode = "mock" as const;

  async generateText(request: AIProviderRequest): Promise<AIProviderResult> {
    await new Promise((resolve) => setTimeout(resolve, 10));

    const text =
      request.task === "business_analysis"
        ? mockBusinessAnalysis
        : `[MOCK AI] Antwoord op: ${request.prompt.slice(0, 80)}...`;

    return {
      text,
      model: `${request.model} (mock)`,
      mode: "mock",
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
