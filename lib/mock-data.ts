import type { ActivityEntry, BadgeVariant, Kpi, Lead, LeadStatus, PipelineStage } from "./types";

export const leads: Lead[] = [
  { id: "ld-001", name: "Jansen Dakwerken", category: "Dakdekkers", location: "Eindhoven", phone: "+31 40 123 4567", email: "info@jansendakwerken.nl", website: null, rating: 4.8, reviewCount: 87, leadScore: 94, status: "interested", hasDemo: true, lastActivity: "5 min geleden" },
  { id: "ld-002", name: "Van der Berg Loodgieters", category: "Loodgieters", location: "Rotterdam", phone: "+31 10 234 5678", email: "info@vanderberg-loodgieters.nl", website: null, rating: 4.6, reviewCount: 132, leadScore: 91, status: "demo_ready", hasDemo: true, lastActivity: "12 min geleden" },
  { id: "ld-003", name: "Kapsalon Mirage", category: "Kappers", location: "Tilburg", phone: "+31 13 345 6789", email: "hallo@kapsalonmirage.nl", website: null, rating: 4.9, reviewCount: 203, leadScore: 88, status: "contacted", hasDemo: true, lastActivity: "1 uur geleden" },
  { id: "ld-004", name: "Groen & Co Hoveniers", category: "Hoveniers", location: "Den Haag", phone: "+31 70 456 7890", email: "info@groenenco.nl", website: null, rating: 4.4, reviewCount: 58, leadScore: 85, status: "replied", hasDemo: true, lastActivity: "3 uur geleden" },
  { id: "ld-005", name: "Elektro Vries", category: "Elektriciens", location: "Zwolle", phone: "+31 38 567 8901", email: "service@elektrovries.nl", website: null, rating: 4.7, reviewCount: 76, leadScore: 82, status: "contacted", hasDemo: false, lastActivity: "6 uur geleden" },
  { id: "ld-006", name: "Schilderwerken De Wit", category: "Schilders", location: "Amsterdam", phone: "+31 20 678 9012", email: null, website: null, rating: 4.3, reviewCount: 41, leadScore: 78, status: "scored", hasDemo: false, lastActivity: "8 uur geleden" },
  { id: "ld-007", name: "Garage Veldhuis", category: "Garages", location: "Groningen", phone: "+31 50 789 0123", email: "info@garageveldhuis.nl", website: null, rating: 4.5, reviewCount: 96, leadScore: 75, status: "new", hasDemo: false, lastActivity: "gisteren" },
  { id: "ld-008", name: "Beauty by Lisa", category: "Schoonheidssalons", location: "Breda", phone: "+31 76 890 1234", email: "info@beautybylisa.nl", website: null, rating: 4.9, reviewCount: 154, leadScore: 72, status: "new", hasDemo: false, lastActivity: "gisteren" },
  { id: "ld-009", name: "Restaurant De Hoeksteen", category: "Restaurants", location: "Nijmegen", phone: "+31 24 901 2345", email: null, website: null, rating: 4.6, reviewCount: 289, leadScore: 65, status: "new", hasDemo: false, lastActivity: "2 dagen geleden" },
  { id: "ld-010", name: "Vaars Schoonmaakdiensten", category: "Schoonmaak", location: "Almere", phone: "+31 36 012 3456", email: "info@vaarsschoonmaak.nl", website: null, rating: 4.2, reviewCount: 33, leadScore: 58, status: "new", hasDemo: false, lastActivity: "3 dagen geleden" },
];

export const leadStatusMeta: Record<LeadStatus, { label: string; variant: BadgeVariant }> = {
  new: { label: "Nieuw", variant: "neutral" },
  analyzing: { label: "In analyse", variant: "info" },
  scored: { label: "Gescoord", variant: "neutral" },
  demo_ready: { label: "Demo klaar", variant: "info" },
  contacted: { label: "Aangeschreven", variant: "info" },
  replied: { label: "Gereageerd", variant: "warning" },
  interested: { label: "Geïnteresseerd", variant: "success" },
  qualified: { label: "Gekwalificeerd", variant: "success" },
  won: { label: "Klant", variant: "success" },
  lost: { label: "Niet geïnteresseerd", variant: "danger" },
};

export const kpis: Kpi[] = [
  { label: "Totaal leads", value: "248", delta: "+32 deze week" },
  { label: "Nieuwe leads", value: "18", delta: "+6 vandaag" },
  { label: "Hoge kwaliteit (80+)", value: "31", delta: "+4 deze week" },
  { label: "E-mails verzonden", value: "96", delta: "+12 vandaag" },
  { label: "Antwoorden", value: "23", delta: "24% reply rate" },
  { label: "Geïnteresseerd", value: "9", delta: "+2 vandaag" },
  { label: "Demo websites", value: "14", delta: "3 in review" },
  { label: "Projecten", value: "4", delta: "1 klaar voor goedkeuring" },
];

export const activities: ActivityEntry[] = [
  { time: "20:31", type: "search", message: "Nieuwe bedrijven gevonden: 12 in Eindhoven (dakdekkers)" },
  { time: "20:32", type: "check", message: "Website check: Jansen Dakwerken — geen website gevonden" },
  { time: "20:32", type: "score", message: "Lead score berekend: Jansen Dakwerken — 94/100" },
  { time: "20:33", type: "demo", message: "Demo website gegenereerd: /demo/jansen-dakwerken" },
  { time: "20:35", type: "email", message: "Persoonlijke e-mail opgesteld voor Jansen Dakwerken" },
  { time: "20:36", type: "send", message: "E-mail verzonden naar info@jansendakwerken.nl" },
  { time: "20:48", type: "reply", message: "Antwoord ontvangen van Jansen Dakwerken" },
  { time: "20:49", type: "qualify", message: "Lead geclassificeerd: Geïnteresseerd" },
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
