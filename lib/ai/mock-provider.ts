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
  const cityMatch = prompt.match(/Plaats: ([^(\n]+)/);
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

function buildMockQualityAnalysis(prompt: string): string {
  // Deterministische, veilige mock-QC: alléén beoordelen wat uit de echte data volgt.
  const nameMatch = prompt.match(/Bedrijf: ([^\n]+)/);
  const businessName = nameMatch ? nameMatch[1].trim() : "Testbedrijf (TESTDATA)";

  const analysis = {
    contentAssessment: {
      result: "warning",
      issues: [
        {
          severity: "info",
          message: `TESTDATA (mock): teksten voor ${businessName} zijn grotendeels placeholders ([INFORMATIE ONBEKEND]) — dit is correct gedrag; ontbrekende informatie is niet als feit gepresenteerd.`,
        },
      ],
      notes: "Content is zakelijk geformuleerd; echte bedrijfsteksten moeten nog worden aangeleverd.",
    },
    designAssessment: {
      result: "passed",
      issues: [],
      notes: "Template-styling is consistent toegepast binnen de gecontroleerde componenten.",
    },
    responsiveAssessment: {
      result: "warning",
      issues: [
        {
          severity: "warning",
          message: "TESTDATA (mock): visuele controle op tablet/desktop is niet uitgevoerd (STRUCTURAL CHECK only).",
        },
      ],
      notes: "Structureel mobile-first; echte weergave is niet visueel geverifieerd.",
    },
    conversionAssessment: {
      result: "passed",
      issues: [],
      notes: "Primaire CTA en contactmogelijkheden zijn aanwezig.",
    },
    businessAccuracyAssessment: {
      result: "passed",
      issues: [],
      notes: `Bedrijfsgegevens op de website komen overeen met de lead-data voor ${businessName}.`,
    },
    recommendations: [
      "TESTDATA (mock): vul de bedrijfsbeschrijving aan zodra deze is aangeleverd.",
      "TESTDATA (mock): voeg echte dienstomschrijvingen toe voor meer duidelijkheid.",
    ],
    summary: `TESTDATA (mock): de website voor ${businessName} voldoet structureel; ontbrekende bedrijfsinformatie is als placeholder gemarkeerd en niet als feit gepresenteerd.`,
  };

  return JSON.stringify(analysis);
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

function buildMockQuestionnaire(prompt: string): string {
  const nameMatch = prompt.match(/Bedrijf: (.+)/);
  const businessName = nameMatch ? nameMatch[1].split("\n")[0].trim() : "Testbedrijf";
  const output = {
    title: `Vragenlijst website voor ${businessName}`,
    intro: `Bedankt voor je interesse! Met deze korte vragenlijst stellen wij jouw website op maat samen. (TESTDATA mock)`,
    questions: [
      { id: "main_goal", label: "Wat is het belangrijkste doel van jouw website?", type: "select", options: ["Meer aanvragen", "Meer telefoontjes", "Betere uitstraling", "Verkopen via de website"], required: true },
      { id: "pages", label: "Hoeveel pagina's heb je ongeveer nodig?", type: "select", options: ["1 (one-pager)", "3-5", "5-10"], required: true },
      { id: "inspiration", label: "Zijn er websites die je mooi vindt? Noem er maximaal 3 (optioneel).", type: "textarea" },
      { id: "logo_brand", label: "Heb je al een logo en huisstijl?", type: "select", options: ["Ja, compleet", "Alleen een logo", "Nog niets"], required: true },
      { id: "content_upload", label: "Heb je teksten of foto\'s die we kunnen gebruiken? Upload ze hier (optioneel).", type: "upload" },
    ],
  };
  return JSON.stringify(output);
}

export function buildMockDesignPlan(prompt: string): string {
  // Deterministische, veilige mock-designplanning: uitsluitend echte data
  // uit de prompt; alle onbekende velden zijn null en worden expliciet als
  // missingInformation genoemd — nooit fabricatie.
  const businessName = prompt.match(/Bedrijf: ([^\n]+)/)?.[1]?.trim() ?? "Testbedrijf (TESTDATA)";
  const industry = prompt.match(/Branche: ([^\n]+)/)?.[1]?.trim() ?? "Dienstverlening (TESTDATA)";
  const city = prompt.match(/Plaats: ([^\n(]+)/)?.[1]?.trim() ?? "Teststad (TESTDATA)";
  const pagesMatch = prompt.match(/AANTAL PAGINA'S \(bindend voor de paginastructuur\): (\d+)/);
  const pageCount = pagesMatch ? Number.parseInt(pagesMatch[1], 10) : 1;
  const ecommerce = /E-COMMERCE: ja/.test(prompt);

  const missing: string[] = [];
  const pages: Array<Record<string, unknown>> = [];
  const navigation: Array<Record<string, unknown>> = [];
  // BLUEPRINT v2 (Fase A): deterministische, registry-conforme
  // machine-architectuur per pagina. Compositie-hints zijn null (geen
  // fabricatie); de structuur zelf volgt de gesloten SECTION-REGISTRY en
  // doorloopt exact dezelfde validatie als live-AI-output.
  const blueprintPages: Array<Record<string, unknown>> = [];
  for (let i = 1; i <= pageCount; i += 1) {
    const key = i === 1 ? "home" : `page-${i}`;
    pages.push({
      key,
      title: i === 1 ? `Home | ${businessName}` : `Pagina ${i}`,
      purpose: i === 1 ? `Kernpagina met aanbod en conversie voor ${businessName}.` : `Aanvullende pagina binnen de afgesproken scope.`,
      sections: i === 1 ? ["hero", "diensten", "over", "contact"] : ["intro", "content", "contact"],
    });
    navigation.push({ label: i === 1 ? "Home" : `Pagina ${i}`, pageKey: key });
    const homeInstances = [
      {
        type: "hero",
        layout: "split",
        blocks: [],
        media: [{ role: "image", ratio: "wide", alt: null }],
        cta: { label: "Neem contact op", target: "form", prominence: "primary" },
        background: "default",
        motion: "none",
        contentHints: `Primaire boodschap voor ${businessName}.`,
      },
      {
        type: "services",
        layout: "grid",
        blocks: [1, 2, 3].map((n) => ({ kind: "service", hint: `Dienst ${n} (TESTDATA)` })),
        media: [],
        cta: null,
        background: "default",
        motion: "none",
        contentHints: null,
      },
      {
        type: "cta",
        layout: "band",
        blocks: [],
        media: [],
        cta: { label: "Vraag een offerte aan", target: "form", prominence: "primary" },
        background: "surface",
        motion: "none",
        contentHints: null,
      },
      {
        type: "contact",
        layout: "split",
        blocks: [],
        media: [],
        cta: null,
        background: "default",
        motion: "none",
        contentHints: null,
      },
    ];
    const subPageInstances = [
      {
        type: "rich_text",
        layout: "article",
        blocks: [{ kind: "paragraph", hint: `Aanvullende informatie (TESTDATA)` }],
        media: [],
        cta: null,
        background: "default",
        motion: "none",
        contentHints: null,
      },
      {
        type: "cta",
        layout: "closing",
        blocks: [],
        media: [],
        cta: { label: "Terug naar het aanbod", target: "home", prominence: "secondary" },
        background: "default",
        motion: "none",
        contentHints: null,
      },
    ];
    blueprintPages.push({
      key,
      title: i === 1 ? `Home | ${businessName}` : `Pagina ${i}`,
      purpose: i === 1 ? `Kernpagina met aanbod en conversie voor ${businessName}.` : `Aanvullende pagina binnen de afgesproken scope.`,
      seo: null,
      sectionInstances: i === 1 ? homeInstances : subPageInstances,
    });
  }

  if (!/SPECIALE WENSEN:/.test(prompt)) missing.push("Speciale wensen zijn niet gedocumenteerd");
  if (/QUESTIONNAIRE-ANTWOORDEN: geen/.test(prompt)) missing.push("Questionnaire-antwoorden ontbreken");
  if (!/E-COMMERCE: (ja|nee)/.test(prompt)) missing.push("E-commerce-wens is onbekend");

  const plan = {
    goals: {
      primaryGoal: `Professionele online presentatie waarmee ${businessName} aanvragen genereert.`,
      secondaryGoals: [],
      conversionGoal: null,
    },
    audience: {
      primaryAudience: null,
      secondaryAudiences: [],
      toneOfVoice: null,
    },
    navigation: {
      items: navigation,
      structure: "Eén hoofdnavigatie met mobiel menu.",
    },
    pageStructure: pages,
    visualHierarchy: {
      strategy: "Duidelijke hiërarchie: hero met primaire boodschap, daarna ondersteunende secties.",
      aboveTheFold: ["Hero met primaire CTA"],
    },
    branding: {
      styleDirection: null,
      mood: [],
      existingBrandAssets: null,
      preferredColors: [],
      dislikedColors: [],
      restrictions: [],
    },
    typography: {
      pairing: null,
      scale: null,
      weights: [],
      rationale: null,
    },
    colors: {
      primary: null,
      secondary: null,
      accent: null,
      neutrals: [],
      usageGuidance: null,
    },
    spacing: {
      scale: null,
      density: null,
    },
    components: [
      { key: "header", purpose: "Bedrijfsnaam en navigatie", notes: null },
      { key: "hero", purpose: "Primaire boodschap met CTA", notes: null },
      { key: "services", purpose: "Aanbod van het bedrijf", notes: null },
      { key: "contact", purpose: "Contactmogelijkheden", notes: null },
      { key: "footer", purpose: "Bedrijfsgegevens en sluiting", notes: null },
    ],
    ctaStrategy: {
      primary: null,
      secondary: null,
      placement: [],
      leadCapture: null,
    },
    imagery: {
      style: null,
      requirements: [`Heldere beeldbehoeften voor ${industry} in ${city}`],
      placeholderStrategy: null,
    },
    responsive: {
      mobile: "Mobile-first layout met volledige navigatie via menu.",
      tablet: null,
      desktop: null,
      breakpoints: [],
    },
    animation: {
      strategy: null,
      allowed: [],
      restrictions: [],
    },
    functionality: {
      features: ecommerce
        ? [{ key: "webshop", description: "E-commerce volgens de requirements", source: "requirements" }]
        : [],
      integrations: [],
    },
    accessibility: {
      contrast: null,
      focusAndKeyboard: null,
      semantics: "Semantische HTML met logische kopstructuur.",
      formsAndLabels: null,
      guidelines: [],
    },
    seoPerformance: {
      titleStrategy: null,
      metaStrategy: null,
      localSeo: `Lokale vindbaarheid voor ${city}.`,
      performanceBudget: null,
      imageOptimization: null,
    },
    basis: {
      sources: ["lead", "requirements"],
    },
    blueprint: {
      version: 2,
      pages: blueprintPages,
      trustElements: { usps: [], stats: [], badges: [] },
      conversionPlan: { primaryGoal: null, leadCapture: null, contactPreference: null },
      // Eerlijke trust-disclosure: de mock kent geen echte USP's/cijfers/reviews, dus
      // plant hij geen trust-secties en registreert dat expliciet (conversieketen-
      // check A3: trust mag ontbreken mits eerlijk gemarkeerd, nooit fabriceren).
      missingInformation: [
        "TESTDATA (mock): geen echte USP's, cijfers of reviews aangeleverd — trust-secties zijn niet gepland.",
      ],
    },
    missingInformation: missing,
  };

  return JSON.stringify(plan);
}

function buildMockQuestionnaireCompletion(prompt: string): string {
  const round2 = /RONDE 2/.test(prompt);
  const output = round2
    ? {
        sufficient: true,
        summary: "TESTDATA (mock): met de aanvullende antwoorden is er voldoende betrouwbare informatie voor een ontwerp- en bouwvoorstel.",
        resolvedInformation: [{ key: "regio", value: "TESTDATA (mock): regio al bekend uit leadgegevens" }],
        missingInformation: [],
        followUpQuestions: [],
        // C1-mock: alle dimensies eerlijk herleid; declinabele dimensies
        // expliciet afgezegd (er is gén echte data in de mock — nooit fabriceren).
        contentDimensions: {
          offering: "TESTDATA (mock): concreet aanbod uit de antwoorden",
          usps: "TESTDATA (mock): USP 1 en USP 2 uit de antwoorden",
          proof: "NIET_BESCHIKBAAR: TESTDATA (mock): klant bevestigt dat er geen reviews zijn",
          audience: "TESTDATA (mock): doelgroep uit de antwoorden",
          toneOfVoice: "TESTDATA (mock): gewenste toon uit de antwoorden",
          branding: "NIET_BESCHIKBAAR: TESTDATA (mock): klant geeft toestemming de huisstijl te bepalen",
          media: "NIET_BESCHIKBAAR: TESTDATA (mock): klant bevestigt dat er geen foto\'s zijn",
        },
      }
    : {
        sufficient: false,
        summary: "TESTDATA (mock): de kern is bekend, maar een paar noodzakelijke details ontbreken nog.",
        resolvedInformation: [{ key: "bedrijfsnaam", value: "TESTDATA (mock): bedrijfsnaam al bekend uit leadgegevens" }],
        missingInformation: ["TESTDATA (mock): gewenste paginastructuur", "TESTDATA (mock): beschikbare teksten/foto\'s"],
        followUpQuestions: [
          { id: "follow_up_pages", label: "Welke pagina\'s wil je zeker terugzien? (bijv. Home, Diensten, Over ons, Contact)", type: "textarea", required: true },
          { id: "follow_up_content", label: "Heb je teksten en foto\'s beschikbaar voor de website?", type: "select", options: ["Ja, alles", "Deels", "Nee, maken jullie die?"], required: true },
        ],
        // C1-mock: ronde 1 is eerlijk onvolledig (usps/proof/branding/media onbekend).
        contentDimensions: {
          offering: "TESTDATA (mock): concreet aanbod uit de antwoorden",
          usps: "",
          proof: "",
          audience: "TESTDATA (mock): doelgroep uit de antwoorden",
          toneOfVoice: "TESTDATA (mock): gewenste toon uit de antwoorden",
          branding: "",
          media: "",
        },
      };
  return JSON.stringify(output);
}

/**
 * Deterministische mock voor de C3b-content-pass: leest de machine-contract-
 * regels (BRON/SECTIE) uit de prompt en vult coverage-compleet — fact-locked
 * als exacte bronovername, commerciële copy als generated met evidence.
 * Nooit fabricatie: elke tekst stamt uit een BRON-regel.
 */
export function buildMockContentPlan(prompt: string): string {
  const sources: Array<{ origin: string; key: string; text: string }> = [];
  for (const line of prompt.split("\n")) {
    const match = line.match(/^BRON \[(.+?):(.+?)\] (.+)$/);
    if (match) sources.push({ origin: match[1], key: match[2], text: match[3] });
  }

  const pages: Array<{ key: string; seo: null; units: unknown[] }> = [];
  let currentPage: { key: string; seo: null; units: unknown[] } | null = null;
  let sourceIndex = 0;
  const nextSource = () => sources[sourceIndex++ % sources.length] ?? null;

  for (const line of prompt.split("\n")) {
    const pageMatch = line.match(/^PAGINA ([\w-]+) /);
    if (pageMatch) {
      currentPage = { key: pageMatch[1], seo: null, units: [] };
      pages.push(currentPage);
      continue;
    }
    const sectionMatch = line.match(/^SECTIE ([\w-]+\/\d+) (\S+) — verplicht: ([^;]*);/);
    if (!sectionMatch || !currentPage) continue;
    const required = sectionMatch[3]
      .split(",")
      .map((kind) => kind.trim())
      .filter((kind) => kind.length > 0 && kind !== "(geen)");

    const factLockedPart = line.match(/fact-locked: ([^;]+)/)?.[1] ?? "(geen)";
    const factLockedKinds = new Set(
      factLockedPart
        .split(",")
        .map((kind) => kind.trim())
        .filter((kind) => kind.length > 0 && kind !== "(geen)")
    );

    for (const kind of required) {
      const source = nextSource();
      if (source && factLockedKinds.has(kind)) {
        currentPage.units.push({
          path: sectionMatch[1],
          kind,
          status: "fixed",
          text: source.text,
          evidence: [],
          sourceOrigin: source.origin,
          instruction: null,
        });
      } else if (source) {
        currentPage.units.push({
          path: sectionMatch[1],
          kind,
          status: "generated",
          text: `Mock-copy voor ${kind} (uit bron ${source.key}).`,
          evidence: [source.text],
          sourceOrigin: null,
          instruction: null,
        });
      } else {
        currentPage.units.push({
          path: sectionMatch[1],
          kind,
          status: "customer_slot",
          text: null,
          evidence: [],
          sourceOrigin: null,
          instruction: `Lever de inhoud voor ${kind}: wat moet hier komen te staan, uit jouw eigen woorden.`,
        });
      }
    }
  }

  return JSON.stringify({ pages, missingInformation: [] });
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
              : request.task === "design_planning"
                ? buildMockDesignPlan(request.prompt)
              : request.task === "content_generation"
                ? buildMockContentPlan(request.prompt)
              : request.task === "website_quality_analysis"
                ? buildMockQualityAnalysis(request.prompt)
                : request.task === "questionnaire_generation"
                  ? buildMockQuestionnaire(request.prompt)
                  : request.task === "questionnaire_completion"
                    ? buildMockQuestionnaireCompletion(request.prompt)
                    : `[MOCK AI] Antwoord op: ${request.prompt.slice(0, 80)}...`;

    return {
      text,
      model: `${request.model} (mock)`,
      mode: "mock",
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
