import { scoreLead } from "@/lib/agents/lead-scoring";
import { demoStatusForLead } from "@/lib/mock-demos";
import type {
  ActivityEntry,
  BadgeVariant,
  DemoStatus,
  Kpi,
  Lead,
  LeadAiAnalysis,
  LeadSourceType,
  LeadStatus,
  OutreachStatus,
  PipelineStage,
  WebsiteStatus,
} from "@/lib/types";

/**
 * Centrale mock data — Fase 2. Alle bedrijven, contactgegevens en
 * reviews zijn fictief. Later wordt deze dataset vervangen door echte
 * database-data zonder dat de UI-componenten hoeven te veranderen.
 */

type LeadSeed = Omit<Lead, "leadScore" | "aiAnalysis" | "demoStatus">;

const rawLeads: LeadSeed[] = [
  { id: "ld-001", businessName: "Jansen Dakwerken", industry: "Dakwerken", address: "Dakpanstraat 12", postalCode: "5612 AB", city: "Eindhoven", province: "Noord-Brabant", country: "Nederland", phone: "+31 40 123 4567", email: "info@jansendakwerken.nl", website: null, websiteStatus: "no_website", googleRating: 4.8, reviewCount: 87, leadStatus: "interested", outreachStatus: "replied", source: "mock", notes: ["Klant reageerde enthousiast op de demo."], createdAt: "2026-09-14T20:31:00.000Z", updatedAt: "2026-09-15T20:50:00.000Z" },
  { id: "ld-002", businessName: "Van der Berg Loodgieters", industry: "Loodgieters", address: "Leidingweg 8", postalCode: "3021 CD", city: "Rotterdam", province: "Zuid-Holland", country: "Nederland", phone: "+31 10 234 5678", email: "info@vanderberg-loodgieters.nl", website: null, websiteStatus: "no_website", googleRating: 4.6, reviewCount: 132, leadStatus: "qualified", outreachStatus: "opened", source: "mock", notes: [], createdAt: "2026-09-13T09:12:00.000Z", updatedAt: "2026-09-14T11:03:00.000Z" },
  { id: "ld-003", businessName: "Bakker Installatietechniek", industry: "Installatietechniek", address: "Ketelstraat 45", postalCode: "4811 GH", city: "Breda", province: "Noord-Brabant", country: "Nederland", phone: "+31 76 555 0192", email: "info@bakkerinstallatie.nl", website: null, websiteStatus: "no_website", googleRating: 4.7, reviewCount: 98, leadStatus: "contacted", outreachStatus: "sent", source: "mock", notes: [], createdAt: "2026-09-12T14:40:00.000Z", updatedAt: "2026-09-14T09:25:00.000Z" },
  { id: "ld-004", businessName: "Groen & Co Hoveniers", industry: "Hoveniers", address: "Tuinlaan 3", postalCode: "2513 KL", city: "Den Haag", province: "Zuid-Holland", country: "Nederland", phone: "+31 70 456 7890", email: "info@groenenco.nl", website: null, websiteStatus: "no_website", googleRating: 4.4, reviewCount: 58, leadStatus: "interested", outreachStatus: "replied", source: "mock", notes: ["Vraagt naar onderhoudsmogelijkheden."], createdAt: "2026-09-12T08:02:00.000Z", updatedAt: "2026-09-14T17:30:00.000Z" },
  { id: "ld-005", businessName: "Elektro Vries", industry: "Elektriciens", address: "Schakelstraat 21", postalCode: "8011 MP", city: "Zwolle", province: "Overijssel", country: "Nederland", phone: "+31 38 567 8901", email: "service@elektrovries.nl", website: null, websiteStatus: "no_website", googleRating: 4.7, reviewCount: 76, leadStatus: "contacted", outreachStatus: "sent", source: "mock", notes: [], createdAt: "2026-09-11T16:22:00.000Z", updatedAt: "2026-09-14T18:48:00.000Z" },
  { id: "ld-006", businessName: "Schilderwerken De Wit", industry: "Schilders", address: "Kwaststraat 17", postalCode: "1013 PP", city: "Amsterdam", province: "Noord-Holland", country: "Nederland", phone: "+31 20 678 9012", email: null, website: null, websiteStatus: "no_website", googleRating: 4.3, reviewCount: 41, leadStatus: "analyzing", outreachStatus: "draft", source: "mock", notes: [], createdAt: "2026-09-11T10:45:00.000Z", updatedAt: "2026-09-13T19:12:00.000Z" },
  { id: "ld-007", businessName: "Garage Veldhuis", industry: "Autogarages", address: "Motordreef 9", postalCode: "9713 AR", city: "Groningen", province: "Groningen", country: "Nederland", phone: "+31 50 789 0123", email: "info@garageveldhuis.nl", website: null, websiteStatus: "no_website", googleRating: 4.5, reviewCount: 96, leadStatus: "qualified", outreachStatus: "opened", source: "mock", notes: [], createdAt: "2026-09-10T12:18:00.000Z", updatedAt: "2026-09-13T10:07:00.000Z" },
  { id: "ld-008", businessName: "Van Dijk Bouw", industry: "Bouwbedrijven", address: "Funderingsweg 102", postalCode: "5015 BX", city: "Tilburg", province: "Noord-Brabant", country: "Nederland", phone: "+31 13 444 2200", email: "contact@vandijkbouw.nl", website: "www.vandijkbouw.nl", websiteStatus: "has_website", googleRating: 4.6, reviewCount: 64, leadStatus: "new", outreachStatus: "not_contacted", source: "mock", notes: [], createdAt: "2026-09-10T09:30:00.000Z", updatedAt: "2026-09-10T09:30:00.000Z" },
  { id: "ld-009", businessName: "Keukens van Velzen", industry: "Keukenzaken", address: "Werkbladlaan 5", postalCode: "1315 KD", city: "Almere", province: "Flevoland", country: "Nederland", phone: "+31 36 012 3456", email: "info@keukensvanvelzen.nl", website: "www.keukensvanvelzen.nl", websiteStatus: "website_poor", googleRating: 4.2, reviewCount: 29, leadStatus: "new", outreachStatus: "not_contacted", source: "mock", notes: [], createdAt: "2026-09-09T15:05:00.000Z", updatedAt: "2026-09-09T15:05:00.000Z" },
  { id: "ld-010", businessName: "Helder Schoonmaak", industry: "Schoonmaak", address: "Gladstraat 33", postalCode: "3511 SX", city: "Utrecht", province: "Utrecht", country: "Nederland", phone: "+31 30 221 8890", email: "info@helderschoonmaak.nl", website: null, websiteStatus: "no_website", googleRating: 4.1, reviewCount: 33, leadStatus: "new", outreachStatus: "not_contacted", source: "mock", notes: [], createdAt: "2026-09-08T11:44:00.000Z", updatedAt: "2026-09-08T11:44:00.000Z" },
  { id: "ld-011", businessName: "Wolters Schilders", industry: "Schilders", address: "Verflaan 28", postalCode: "2011 ZK", city: "Haarlem", province: "Noord-Holland", country: "Nederland", phone: "+31 23 445 6789", email: "info@woltersschilders.nl", website: null, websiteStatus: "no_website", googleRating: 4.9, reviewCount: 112, leadStatus: "contacted", outreachStatus: "replied", source: "mock", notes: ["Demo-generatie mislukt — opnieuw plannen."], createdAt: "2026-09-07T13:20:00.000Z", updatedAt: "2026-09-13T09:41:00.000Z" },
  { id: "ld-012", businessName: "De Roode Dakwerken", industry: "Dakwerken", address: "Nokstraat 71", postalCode: "7511 ZC", city: "Enschede", province: "Overijssel", country: "Nederland", phone: "+31 53 333 4455", email: "info@deroodedakwerken.nl", website: null, websiteStatus: "no_website", googleRating: 4.6, reviewCount: 203, leadStatus: "qualified", outreachStatus: "opened", source: "mock", notes: [], createdAt: "2026-09-06T17:55:00.000Z", updatedAt: "2026-09-14T08:19:00.000Z" },
  { id: "ld-013", businessName: "Prins Loodgieters", industry: "Loodgieters", address: "Kraanstraat 14", postalCode: "7311 AA", city: "Apeldoorn", province: "Gelderland", country: "Nederland", phone: "+31 55 122 3344", email: null, website: "www.prinsloodgieters.nl", websiteStatus: "website_poor", googleRating: 4.0, reviewCount: 24, leadStatus: "lost", outreachStatus: "opted_out", source: "mock", notes: ["Heeft aangegeven geen interesse te hebben."], createdAt: "2026-09-05T09:02:00.000Z", updatedAt: "2026-09-11T14:00:00.000Z" },
  { id: "ld-014", businessName: "Sterk Elektro", industry: "Elektriciens", address: "Voltstraat 50", postalCode: "6511 AB", city: "Nijmegen", province: "Gelderland", country: "Nederland", phone: "+31 24 901 2345", email: "info@sterkelektro.nl", website: null, websiteStatus: "unknown", googleRating: 4.8, reviewCount: 77, leadStatus: "won", outreachStatus: "interested", source: "mock", notes: ["Wordt klant — project in ontwikkeling."], createdAt: "2026-09-04T10:26:00.000Z", updatedAt: "2026-09-15T16:44:00.000Z" },
  { id: "ld-015", businessName: "Vos Hoveniers", industry: "Hoveniers", address: "Boslaan 88", postalCode: "6211 XC", city: "Maastricht", province: "Limburg", country: "Nederland", phone: "+31 43 556 7788", email: "info@voshoveniers.nl", website: null, websiteStatus: "no_website", googleRating: 4.5, reviewCount: 49, leadStatus: "analyzing", outreachStatus: "draft", source: "mock", notes: [], createdAt: "2026-09-03T14:38:00.000Z", updatedAt: "2026-09-12T18:26:00.000Z" },
];

export function mockAiAnalysis(lead: LeadSeed): LeadAiAnalysis {
  const hasWebsite = lead.websiteStatus === "has_website";
  return {
    businessSummary: `Local ${lead.industry.toLowerCase()} company serving customers in ${lead.city} and surrounding areas${lead.reviewCount ? ` with ${lead.reviewCount} customer reviews` : ""}.`,
    opportunity:
      hasWebsite || lead.websiteStatus === "website_poor"
        ? "Modernize the existing web presence for better mobile experience and conversion."
        : "Strong opportunity for a modern lead-generation website — customers search online but the business has no website.",
    potentialProblems:
      lead.websiteStatus === "no_website"
        ? "No professional website detected; visibility depends fully on offline channels."
        : "Current website underperforms on mobile speed and layout.",
    recommendedApproach:
      "Create a conversion-focused local service website with clear CTAs, a service overview and contact options.",
  };
}

export const leads: Lead[] = rawLeads.map((lead) => ({
  ...lead,
  leadScore: scoreLead(lead).score,
  aiAnalysis: mockAiAnalysis(lead),
  demoStatus: demoStatusForLead(lead.id),
}));

export const leadStatusMeta: Record<LeadStatus, { label: string; variant: BadgeVariant }> = {
  new: { label: "New", variant: "neutral" },
  analyzing: { label: "Analyzing", variant: "info" },
  qualified: { label: "Qualified", variant: "info" },
  contacted: { label: "Contacted", variant: "info" },
  interested: { label: "Interested", variant: "success" },
  won: { label: "Won", variant: "success" },
  lost: { label: "Lost", variant: "danger" },
};

export const websiteStatusMeta: Record<WebsiteStatus, { label: string; variant: BadgeVariant }> = {
  no_website: { label: "No website", variant: "warning" },
  has_website: { label: "Has website", variant: "success" },
  website_poor: { label: "Poor website", variant: "neutral" },
  unknown: { label: "Unknown", variant: "neutral" },
};

export const outreachStatusMeta: Record<OutreachStatus, { label: string; variant: BadgeVariant }> = {
  not_contacted: { label: "Not contacted", variant: "neutral" },
  draft: { label: "Draft", variant: "warning" },
  sent: { label: "Sent", variant: "info" },
  opened: { label: "Opened", variant: "info" },
  replied: { label: "Replied", variant: "success" },
  interested: { label: "Interested", variant: "success" },
  opted_out: { label: "Opted out", variant: "danger" },
};

export const demoStatusMeta: Record<DemoStatus, { label: string; variant: BadgeVariant }> = {
  not_created: { label: "Not created", variant: "neutral" },
  generating: { label: "Generating", variant: "info" },
  ready: { label: "Ready", variant: "success" },
  failed: { label: "Failed", variant: "danger" },
};

export const leadSourceMeta: Record<LeadSourceType, string> = {
  mock: "Mock",
  google: "Google",
  directory: "Directory",
  manual: "Manual",
  referral: "Referral",
  other: "Other",
};

export interface LeadActivityEvent {
  time: string;
  label: string;
}

export function mockLeadActivity(lead: Lead): LeadActivityEvent[] {
  const day = lead.createdAt.slice(0, 10);
  const events: LeadActivityEvent[] = [
    { time: `${day} 09:14`, label: "Lead created" },
    { time: `${day} 09:15`, label: "Business information added" },
    {
      time: `${day} 09:16`,
      label: `Website check completed — ${websiteStatusMeta[lead.websiteStatus].label}`,
    },
    { time: `${day} 09:16`, label: `Lead score calculated — ${lead.leadScore}/100` },
  ];
  if (lead.demoStatus !== "not_created") {
    events.push({ time: `${day} 09:18`, label: "Demo generation queued" });
  }
  if (lead.outreachStatus !== "not_contacted" && lead.outreachStatus !== "opted_out") {
    events.push({ time: `${day} 09:20`, label: "Outreach drafted" });
  }
  return events;
}

export const kpis: Kpi[] = [
  { label: "Total Leads", value: "248", delta: "+32 deze week" },
  { label: "New Leads", value: "42", delta: "+8 vandaag" },
  { label: "High Quality Leads", value: "19", delta: "+4 deze week" },
  { label: "Emails Sent", value: "126", delta: "+12 vandaag" },
  { label: "Replies", value: "31", delta: "25% reply rate" },
  { label: "Interested Leads", value: "12", delta: "+2 vandaag" },
  { label: "Projects", value: "4", delta: "1 klaar voor goedkeuring" },
  { label: "Websites", value: "3", delta: "1 in review" },
];

export const activities: ActivityEntry[] = [
  { time: "20:31", type: "search", message: "Nieuwe bedrijven gevonden: 12 in Eindhoven (Dakwerken)" },
  { time: "20:32", type: "check", message: "Website check: Jansen Dakwerken — geen website gevonden" },
  { time: "20:32", type: "score", message: "Lead score berekend: Jansen Dakwerken — 94/100" },
  { time: "20:33", type: "demo", message: "Demo website gegenereerd: /demo/jansen-dakwerken" },
  { time: "20:35", type: "email", message: "Persoonlijke e-mail opgesteld voor Jansen Dakwerken" },
  { time: "20:36", type: "send", message: "E-mail verzonden naar info@jansendakwerken.nl" },
  { time: "20:48", type: "reply", message: "Antwoord ontvangen van Jansen Dakwerken" },
  { time: "20:49", type: "qualify", message: "Lead geclassificeerd: Interested" },
  { time: "20:50", type: "qualify", message: "AI heeft projectinformatie opgevraagd" },
];

export const pipeline: PipelineStage[] = [
  { label: "Ontdekt", count: 248 },
  { label: "Geanalyseerd", count: 186 },
  { label: "Gekwalificeerd", count: 94 },
  { label: "Demo gegenereerd", count: 42 },
  { label: "Aangeschreven", count: 38 },
  { label: "Gereageerd", count: 23 },
  { label: "Geïnteresseerd", count: 9 },
  { label: "Klant", count: 4 },
];

export const conversationMessages = [
  { sender: "ai" as const, time: "20:36", body: "Goedenavond Jeroen, ik kwam Jansen Dakwerken uit Eindhoven tegen en zag dat jullie geen eigen website hebben. Omdat jullie al veel goede reviews hebben, heb ik vrijblijvend een voorbeeldwebsite gemaakt: [demo link]" },
  { sender: "lead" as const, time: "20:48", body: "Hallo, interessant! Wat zoiets ongeveer kosten?" },
  { sender: "ai" as const, time: "20:50", body: "Leuk dat je reageert! De prijs hangt af van wat je wilt. De meeste websites zoals die van jullie liggen tussen 750 en 1500 euro. Wat voor pagina's had je in gedachten?" },
  { sender: "lead" as const, time: "21:04", body: "Alleen even de diensten laten zien en een contactformulier. En wat betreft foto's, we hebben wel wat van vorige klussen." },
];

export const workflowSteps = [
  { label: "Bedrijven zoeken", enabled: true, detail: "Google Maps / openbare data — Nederland" },
  { label: "Website check", enabled: true, detail: "Bedrijven zonder website markeren als lead" },
  { label: "Bedrijf analyseren", enabled: true, detail: "AI-analyse van branche, reviews en potentie" },
  { label: "Lead score berekenen", enabled: true, detail: "Score 0-100 op basis van 10 factoren" },
  { label: "Demo genereren", enabled: true, detail: "Automatische demo-website per lead" },
  { label: "Persoonlijke e-mail schrijven", enabled: true, detail: "AI-outreach, gepersonaliseerd per bedrijf" },
  { label: "E-mail versturen", enabled: true, detail: "Met dagelijkse limieten en opt-out" },
  { label: "Antwoorden monitoren", enabled: true, detail: "Replies direct in de AI-inbox" },
  { label: "Lead kwalificeren", enabled: true, detail: "AI Sales Agent voert het gesprek" },
  { label: "Projectinfo verzamelen", enabled: true, detail: "Pagina's, foto's, wensen, functies" },
  { label: "Prijsindicatie voorbereiden", enabled: true, detail: "Op basis van configureerbare prijsregels" },
  { label: "Website genereren", enabled: true, detail: "Next.js/Tailwind of Shopify-theme" },
  { label: "Quality check", enabled: true, detail: "Responsive, links, SEO, fouten" },
  { label: "Ready for Silvijn", enabled: true, detail: "Menselijke goedkeuring — altijd aan" },
];

export interface AutomationModule {
  name: string;
  status: "Active" | "Paused" | "Not configured";
  variant: BadgeVariant;
}

export const automationModules: AutomationModule[] = [
  { name: "Business Discovery", status: "Active", variant: "success" },
  { name: "Demo Generation", status: "Active", variant: "success" },
  { name: "AI Outreach", status: "Active", variant: "success" },
  { name: "Sales Agent", status: "Not configured", variant: "neutral" },
  { name: "Website Generation", status: "Not configured", variant: "neutral" },
];

export interface OutreachSummary {
  business: string;
  email: string;
  date: string;
  status: "Draft" | "Sent" | "Opened" | "Replied" | "Interested";
  variant: BadgeVariant;
}

export const recentOutreach: OutreachSummary[] = [
  { business: "Jansen Dakwerken", email: "info@jansendakwerken.nl", date: "20:36", status: "Replied", variant: "success" },
  { business: "Groen & Co Hoveniers", email: "info@groenenco.nl", date: "17:30", status: "Interested", variant: "success" },
  { business: "Kapsalon Mirage", email: "hallo@kapsalonmirage.nl", date: "19:12", status: "Opened", variant: "info" },
  { business: "Elektro Vries", email: "service@elektrovries.nl", date: "18:48", status: "Sent", variant: "neutral" },
  { business: "Van der Berg Loodgieters", email: "info@vanderberg-loodgieters.nl", date: "16:02", status: "Draft", variant: "warning" },
];
