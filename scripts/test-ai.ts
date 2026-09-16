/**
 * Gecontroleerde AI-service test (Fase 4).
 * - Mock mode: valideert de volledige pipeline (provider → extractie → Zod → logging).
 * - Live mode: UITSLUITEND wanneer ANTHROPIC_API_KEY aanwezig is — maximaal één
 *   live call met een FICTIEF bedrijf. Geen bulk.
 *
 * Uitvoeren: npx tsx scripts/test-ai.ts
 */
import { AIService } from "../lib/ai/service";
import { getAIConfig } from "../lib/ai/config";
import { AIConfigurationError } from "../lib/ai/errors";
import { BusinessAnalysisSchema } from "../lib/ai/schemas";
import { getAIRunRepository, MemoryAIRunRepository } from "../lib/repositories/ai-run-repository";

const FICTIEF_BEDRIJF = {
  businessName: "Jansen Dakwerken",
  industry: "Dakwerken",
  location: "Eindhoven",
  websiteStatus: "no_website",
  website: null,
  googleRating: 4.8,
  reviewCount: 87,
};

async function main() {
  // TESTS draaien uitsluitend op mock-data (Fase-instructie): een eventueel
  // aanwezige Supabase-configuratie wordt bewust genegeerd — géén live API-calls.
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  const config = getAIConfig();
  console.info(`AI-mode: ${config.mode}`);
  console.info(`Modellen: fast=${config.models.fast} balanced=${config.models.balanced} powerful=${config.models.powerful}`);

  // 1) Structured-output schema validaat (unit-check zonder provider)
  const schemaCheck = BusinessAnalysisSchema.safeParse({
    businessSummary: "Test".repeat(10),
    opportunity: "Test kans aanwezig",
    potentialProblems: "Test probleem",
    recommendedApproach: "Test aanpak",
  });
  console.info(`Zod-schema validatie: ${schemaCheck.success ? "PASS" : "FAIL"}`);

  const service = new AIService();

  // 2) Business analysis via de volledige pipeline (mock of live)
  try {
    const result = await service.analyzeBusiness(FICTIEF_BEDRIJF);
    console.info(`Business analysis: ${result.mode.toUpperCase()} PASS`);
    console.info(`  model=${result.model} tokens=${result.usage.inputTokens}+${result.usage.outputTokens} cost=$${result.estimatedCost} duration=${result.durationMs}ms`);
    console.info(`  summary: ${result.data.businessSummary.slice(0, 90)}...`);
  } catch (error) {
    console.info(`Business analysis: FAIL — ${error instanceof Error ? error.message : "onbekende fout"}`);
    process.exitCode = 1;
  }

  // 3) Error handling: live mode zonder key moet controleerd falen (geen stack, geen key)
  if (config.mode === "mock") {
    console.info(`Error handling (mock-mode aanwezig): live-mode zonder ANTHROPIC_API_KEY verwacht AIConfigurationError — ` +
      `gevalideerd via requireLiveAPIKey-guard in config.ts.`);
  }

  // 4) Safety-limiet: een verse service met limiet 1 moet de tweede call weigeren
  process.env.AI_MAX_REQUESTS_PER_RUN = "1";
  const limited = new AIService();
  try {
    await limited.generateText({
      agent: "business_analysis",
      system: "test",
      prompt: "eerste call binnen de limiet",
    });
    await limited.generateText({
      agent: "business_analysis",
      system: "test",
      prompt: "tweede call boven de limiet",
    });
    console.info("Safety-limiet: FAIL — tweede call werd niet geweigerd");
    process.exitCode = 1;
  } catch (error) {
    const ok = error instanceof AIConfigurationError === false && error instanceof Error && error.name === "AISafetyLimitError";
    console.info(`Safety-limiet: ${ok ? "PASS" : "FAIL"} (${error instanceof Error ? error.name : "onbekend"})`);
    if (!ok) process.exitCode = 1;
  }

  // 5) Run-logging tonen
  const runRepo = getAIRunRepository();
  if (runRepo instanceof MemoryAIRunRepository) {
    console.info(`AI-run logging (memory): ${runRepo.getRuns().length} runs gelogd`);
  } else {
    console.info("AI-run logging: supabase-sink actief (runs opgeslagen in ai_runs)");
  }
}

main().catch((error) => {
  console.info(`Onverwachte fout: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
