import type { ObjectionType, SalesIntent } from "@/lib/ai/types";

/**
 * Deterministische keyword-classificatie — ALLÉÉN gebruikt door de MockAIProvider
 * (AI_MODE=mock). De echte classificatie doet het live model; dit is puur
 * voorspelbare testlogica zonder API-calls.
 */

export interface MockSalesClassification {
  intent: SalesIntent;
  objectionType: ObjectionType | "none";
  interestLevel: "none" | "low" | "medium" | "high";
  escalationRequired: boolean;
  escalationReason: string | null;
}

const RULES: { pattern: RegExp; result: MockSalesClassification }[] = [
  { pattern: /(afmelden|uitschrijven|unsubscribe|geen (e-?mails|berichten))/i,
    result: { intent: "opt_out", objectionType: "not_interested", interestLevel: "none", escalationRequired: false, escalationReason: null } },
  { pattern: /(verkeerde (persoon|adres)|niet bij dit bedrijf|doorgestuurd naar)/i,
    result: { intent: "wrong_contact", objectionType: "unclear", interestLevel: "none", escalationRequired: false, escalationReason: null } },
  { pattern: /(geen interesse|niet geïnteresseerd|nee bedankt)/i,
    result: { intent: "not_interested", objectionType: "not_interested", interestLevel: "none", escalationRequired: false, escalationReason: null } },
  { pattern: /(te duur|te prijzig|buiten (het|ons|mijn) budget)/i,
    result: { intent: "objection", objectionType: "price_objection", interestLevel: "low", escalationRequired: false, escalationReason: null } },
  { pattern: /(al (een |een goede )?(website|site)|bestaande (website|partij)|andere (partij|leverancier|webdesigner))/i,
    result: { intent: "objection", objectionType: "existing_provider", interestLevel: "low", escalationRequired: false, escalationReason: null } },
  { pattern: /(concurrent|biedt goedkoper|andere aanbieder)/i,
    result: { intent: "objection", objectionType: "competitor", interestLevel: "low", escalationRequired: false, escalationReason: null } },
  { pattern: /(geen tijd|te druk|nu niet|komende maanden geen)/i,
    result: { intent: "not_now", objectionType: "timing_objection", interestLevel: "low", escalationRequired: false, escalationReason: null } },
  { pattern: /(niet betrouwbaar|eerst referenties|twijfel|scam)/i,
    result: { intent: "objection", objectionType: "trust_objection", interestLevel: "low", escalationRequired: true, escalationReason: "Vertrouwensvraag van de lead — menselijke opvolging aanbevolen." } },
  { pattern: /(wat kost|hoe duur|prijsindicatie|prijs|een offerte|kosten)/i,
    result: { intent: "price_request", objectionType: "none", interestLevel: "medium", escalationRequired: true, escalationReason: "Lead vraagt om een prijsindicatie — prijsregels volgen in een latere fase." } },
  { pattern: /(korting|goedkoper (kunnen|doen))/i,
    result: { intent: "price_request", objectionType: "price_objection", interestLevel: "medium", escalationRequired: true, escalationReason: "Lead vraagt om korting — alleen Silvijn kan hierover beslissen." } },
  { pattern: /(later|volgend (jaar|kwartaal)|misschien (in|over))/i,
    result: { intent: "not_now", objectionType: "timing_objection", interestLevel: "low", escalationRequired: false, escalationReason: null } },
  { pattern: /(contract|juridisch|algemene voorwaarden|aansprakelijkheid|betalingsvoorwaarden)/i,
    result: { intent: "question", objectionType: "unclear", interestLevel: "medium", escalationRequired: true, escalationReason: "Contractuele/juridische vraag — buiten de AI-bevoegdheid." } },
  { pattern: /(custom|complexe|webshop|e-?commerce|shopify|integratie|koppeling|boekingssysteem)/i,
    result: { intent: "more_information", objectionType: "unclear", interestLevel: "medium", escalationRequired: true, escalationReason: "Complexe/custom projectaanvraag — menselijke beoordeling nodig." } },
  { pattern: /(bellen|bel me|telefonisch|telefoon|een gesprek|afspraak)/i,
    result: { intent: "call_request", objectionType: "none", interestLevel: "high", escalationRequired: false, escalationReason: null } },
  { pattern: /(meer informatie|kunt u (meer|iets meer)|toelichting)/i,
    result: { intent: "more_information", objectionType: "none", interestLevel: "medium", escalationRequired: false, escalationReason: null } },
  { pattern: /(interesse|klinkt (goed|interessant)|graag (meer|een)|wil ik|ziet er (goed|mooi|interessant) uit)/i,
    result: { intent: "interested", objectionType: "none", interestLevel: "high", escalationRequired: false, escalationReason: null } },
  { pattern: /(demo|voorbeeldwebsite|voorbeeld (eens )?(bekijken|zien))/i,
    result: { intent: "demo_request", objectionType: "none", interestLevel: "high", escalationRequired: false, escalationReason: null } },
  { pattern: /\?/,
    result: { intent: "question", objectionType: "none", interestLevel: "low", escalationRequired: false, escalationReason: null } },
];

export function classifyMockInbound(body: string, subject: string): MockSalesClassification {
  const text = `${subject} ${body}`;
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return rule.result;
  }
  // Geen enkele match: niet gokken — UNCLEAR
  return { intent: "unclear", objectionType: "unclear", interestLevel: "none", escalationRequired: true, escalationReason: "Reactie is niet eenduidig te classificeren." };
}
