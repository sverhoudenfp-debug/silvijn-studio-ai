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

function buildMockRequirementsAnalysis(prompt: string): string {
  const lower = prompt.toLowerCase();
  const wantsEcommerce = /webshop|e-?commerce|shopify|bestellen/.test(lower);
  const wantsCustom = /custom|integratie|koppeling|boekingssysteem|complexe/.test(lower);
  const wantsPages = prompt.match(/(\d+)\s*pagina/);
  const numberOfPages = wantsPages ? Number.parseInt(wantsPages[1], 10) : null;

  const requirements = {
    websiteType: wantsEcommerce ? "webshop" : "business_website",
    numberOfPages,
    designLevel: null,
    responsive: true,
    cms: null,
    ecommerce: wantsEcommerce,
    customFunctionality: wantsCustom ? "TESTDATA (mock): aangevraagde custom functionaliteit uit de reacties" : null,
    integrations: wantsCustom ? ["TESTDATA (mock): koppeling boekingssysteem"] : null,
    seo: null,
    copywriting: null,
    photography: null,
    hosting: null,
    maintenance: null,
    deadline: null,
    existingWebsite: null,
    existingBranding: null,
    contentAvailable: null,
    specialRequirements: null,
  };

  const output = {
    projectType: wantsEcommerce ? "webshop" : "website",
    complexity: wantsCustom || wantsEcommerce ? "custom" : numberOfPages && numberOfPages > 5 ? "medium" : "low",
    requirements,
    missingInformation: [
      "TESTDATA (mock): gewenste aantal pagina's is niet bekend.",
      "TESTDATA (mock): designniveau, teksten en foto's zijn onbekend.",
      "TESTDATA (mock): gewenste deadline en budget zijn niet bekend.",
    ],
    questions: [
      "TESTDATA (mock): Hoeveel pagina's moet de website ongeveer krijgen?",
      "TESTDATA (mock): Wanneer wilt u de website online hebben?",
      "TESTDATA (mock): Heeft u al teksten en foto's, of moeten wij die verzorgen?",
    ],
    confidence: 0.55,
  };

  return JSON.stringify(output);
}

function buildMockWebsiteSpecification(prompt: string): string {
  // Deterministische, veilige mock-planning: uitsluitend echte data uit de prompt.
  const nameMatch = prompt.match(/Bedrijf: ([^\n]+)/);
  const industryMatch = prompt.match(/Branche: ([^\n]+)/);
  const cityMatch = prompt.match(/Plaats: ([^\n]+)/);
  const provinceMatch = prompt.match(/provincie ([^)\n]+)\)/);
  const phoneMatch = prompt.match(/Telefoon: ([^\n]+)/);
  const emailMatch = prompt.match(/E-mail: ([^\n]+)/);
  const templateMatch = prompt.match(/TEMPLATESUGGESTIE \(deterministisch\): ([a-z_]+)/);

  const businessName = nameMatch ? nameMatch[1].trim() : "Testbedrijf (TESTDATA)";
  const industry = industryMatch ? industryMatch[1].trim() : "Dienstverlening (TESTDATA)";
  const city = cityMatch ? cityMatch[1].trim() : "Teststad (TESTDATA)";
  const template = templateMatch ? templateMatch[1] : "business_standard";
  const servicesCount = 3;

  const services = [];
  for (let i = 1; i <= servicesCount; i += 1) {
    services.push({
      title: `Dienst ${i} van ${businessName}`,
      description: null,
    });
  }

  const spec = {
    template,
    business: {
      businessName,
      industry,
      city,
      province: provinceMatch ? provinceMatch[1].trim() : null,
      description: `[INFORMATIE ONBEKEND] — beschrijving volgt zodra aangeleverd`,
      targetAudience: null,
    },
    branding: {
      primaryColor: null,
      secondaryColor: null,
      accentColor: null,
      backgroundStyle: "licht en zakelijk (TESTDATA-voorstel)",
      typographyStyle: "modern sans-serif (TESTDATA-voorstel)",
      visualStyle: "professioneel en overzichtelijk (TESTDATA-voorstel)",
    },
    structure: {
      pages: [{ key: "home", title: "Home" }],
      navigation: ["Home", "Diensten", "Over ons", "Contact"],
      sections: ["hero", "services", "about", "cta", "contact"],
    },
    content: {
      headline: `${businessName} — professionele ${industry.toLowerCase()} in ${city}`,
      subheadline: `Persoonlijke service en vakmanschap in ${city} en omgeving. Vraag vrijblijvend naar de mogelijkheden.`,
      valueProposition: null,
      services,
      about: `[INFORMATIE ONBEKEND] — tekst over het bedrijf volgt zodra aangeleverd`,
      benefits: [
        `Actief in ${city} en directe omgeving`,
        "Persoonlijk contact en heldere afspraken",
        "Vrijblijvend kennismakingsgesprek mogelijk",
      ],
      faq: [
        {
          question: `In welke regio is ${businessName} actief?`,
          answer: `Wij werken in ${city} en de directe omgeving. Neem contact op voor de mogelijkheden in uw plaats.`,
        },
        {
          question: "Hoe kan ik een afspraak maken?",
          answer: phoneMatch || emailMatch
            ? "U kunt ons telefonisch of per e-mail bereiken; we plannen vervolgens een moment dat u schikt."
            : "Neem contact op via het contactformulier; we reageren zo snel mogelijk.",
        },
      ],
      testimonials: [],
      contactIntro: `Kom in contact met ${businessName}.`,
      ctaPrimaryText: "Neem contact op",
      ctaSecondaryText: "Bekijk onze diensten",
    },
    conversion: {
      primaryCta: "contact",
      secondaryCta: "diensten",
      contactMethods: [
        ...(phoneMatch ? ["telefoon"] : []),
        ...(emailMatch ? ["e-mail"] : []),
        "contactformulier",
      ],
      leadCapture: true,
    },
    media: {
      imageRequirements: [
        { key: "hero", description: `Sfeerbeeld passend bij ${industry.toLowerCase()} in ${city}`, required: true },
        { key: "services", description: "Werk-/dienstgerelateerd beeldmateriaal (placeholder tot aangeleverd)", required: false },
        { key: "local", description: `Herkenbaar stadsbeeld ${city} (placeholder)`, required: false },
      ],
      imageDescriptions: [`Hero: sfeerbeeld ${industry.toLowerCase()}`, "Services: werkimpressie (placeholder)"],
      imagePlaceholders: ["hero-placeholder", "services-placeholder", "local-placeholder"],
    },
    seo: {
      title: `${businessName} | ${industry} in ${city}`,
      metaDescription: `${businessName} is een ${industry.toLowerCase()} gevestigd in ${city}. Bekijk onze diensten en neem vrijblijvend contact op.`,
      keywords: [industry.toLowerCase(), city.toLowerCase(), `${industry.toLowerCase()} ${city.toLowerCase()}`],
      localArea: city,
    },
    missingInformation: [
      "TESTDATA (mock): bedrijfsbeschrijving is onbekend — placeholder geplaatst.",
      "TESTDATA (mock): echte dienstnamen zijn onbekend — generieke diensten geplaatst.",
      "TESTDATA (mock): foto's/materiaal is niet aangeleverd — placeholder-referenties geplaatst.",
    ],
  };

  return JSON.stringify(spec);
}

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
            : request.task === "requirements_analysis"
              ? buildMockRequirementsAnalysis(request.prompt)
              : request.task === "website_planning"
                ? buildMockWebsiteSpecification(request.prompt)
                : `[MOCK AI] Antwoord op: ${request.prompt.slice(0, 80)}...`;

    return {
      text,
      model: `${request.model} (mock)`,
      mode: "mock",
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
