import type { BadgeVariant, DemoStatus, DemoTemplate, DemoWebsite, GenerationStatus } from "@/lib/types";
import { slugify } from "@/lib/utils";

/**
 * Centrale mock demo-data (Fase 3). Iedere demo is gekoppeld aan een
 * fictieve lead via demo.leadId === lead.id. Lead.demoStatus wordt uit
 * deze dataset afgeleid, zodat er één bron van waarheid is.
 * Status "not_created" = lead zonder demo-record.
 */

export const generationStatusMeta: Record<GenerationStatus, { label: string; variant: BadgeVariant }> = {
  idle: { label: "Idle", variant: "neutral" },
  generating: { label: "Generating", variant: "info" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "danger" },
};

type DemoSeed = Omit<DemoWebsite, "slug" | "previewUrl">;

const rawDemos: DemoSeed[] = [
  { id: "demo-001", leadId: "ld-001", businessName: "Jansen Dakwerken", industry: "Dakwerken", city: "Eindhoven", template: "home_improvement", status: "ready", generationStatus: "completed", headline: "Een dak waar u op kunt vertrouwen", description: "Jansen Dakwerken verzorgt nieuwe daken, renovatie en onderhoud in Eindhoven en omstreken. Vakkundig werk, met garantie en heldere prijzen.", services: ["Nieuwe daken", "Dakrenovatie", "Onderhoud en reparatie", "Dakisolatie"], ctaText: "Vraag vandaag nog een gratis dakinspectie aan", notes: "Eerste versie — klant reageerde positief.", createdAt: "2026-09-14T20:33:00.000Z", updatedAt: "2026-09-15T20:33:00.000Z" },
  { id: "demo-002", leadId: "ld-002", businessName: "Van der Berg Loodgieters", industry: "Loodgieters", city: "Rotterdam", template: "local_service", status: "ready", generationStatus: "completed", headline: "Snelle hulp bij lekkages en verstoppingen", description: "Van der Berg Loodgieters helpt Rotterdam en omstreken binnen het uur bij lekkages, verstoppingen en al het sanitairwerk. Direct, netjes en met garantie.", services: ["Loodgieterswerk", "Ontstoppen", "Lekkages oplossen", "Sanitair installeren"], ctaText: "Bel voor directe hulp in Rotterdam", notes: "", createdAt: "2026-09-13T09:30:00.000Z", updatedAt: "2026-09-13T09:30:00.000Z" },
  { id: "demo-003", leadId: "ld-003", businessName: "Bakker Installatietechniek", industry: "Installatietechniek", city: "Breda", template: "professional_service", status: "ready", generationStatus: "completed", headline: "Complete installatietechniek voor thuis en werk", description: "Van verwarming tot ventilatie: Bakker Installatietechniek ontwerpt, installeert en onderhoudt installaties in Breda en omgeving. Duurzaam en energiezuinig.", services: ["Verwarming", "Ventilatie", "Airconditioning", "Duurzaam advies"], ctaText: "Plan een vrijblijvend adviesgesprek", notes: "", createdAt: "2026-09-12T15:10:00.000Z", updatedAt: "2026-09-14T11:00:00.000Z" },
  { id: "demo-004", leadId: "ld-004", businessName: "Groen & Co Hoveniers", industry: "Hoveniers", city: "Den Haag", template: "local_service", status: "ready", generationStatus: "completed", headline: "Uw tuin, verzorgd door vakmensen", description: "Groen & Co Hoveniers legt tuinen aan en onderhoudt ze het hele jaar door in Den Haag en omstreken. Van ontwerp tot snoeiwerk.", services: ["Tuinonderhoud", "Tuinaanleg", "Snoeiwerk", "Bestrating"], ctaText: "Vraag een vrijblijvende offerte aan", notes: "", createdAt: "2026-09-12T08:45:00.000Z", updatedAt: "2026-09-14T17:31:00.000Z" },
  { id: "demo-005", leadId: "ld-005", businessName: "Elektro Vries", industry: "Elektriciens", city: "Zwolle", template: "professional_service", status: "generating", generationStatus: "generating", headline: "Elektrisch werk waar u op kunt rekenen", description: "Elektro Vries verzorgt installatiewerk, storingen en keuringen in Zwolle en omgeving. Veilig, gecertificeerd en met heldere rapportage.", services: ["Installatiewerk", "Storingen oplossen", "Verlichting", "Veiligheidskeuring"], ctaText: "Vraag een vrijblijvende offerte aan", notes: "Generatie loopt — preview volgt.", createdAt: "2026-09-15T14:02:00.000Z", updatedAt: "2026-09-15T14:02:00.000Z" },
  { id: "demo-006", leadId: "ld-007", businessName: "Garage Veldhuis", industry: "Autogarages", city: "Groningen", template: "business_standard", status: "ready", generationStatus: "completed", headline: "Uw auto in vertrouwde handen", description: "Garage Veldhuis verzorgt onderhoud, reparaties en APK-keuringen in Groningen. Persoonlijk, eerlijk en altijd met een duidelijke prijsopgave.", services: ["Onderhoud en reparatie", "APK-keuring", "Bandenservice", "Airco-service"], ctaText: "Plan direct een afspraak", notes: "", createdAt: "2026-09-10T12:30:00.000Z", updatedAt: "2026-09-13T10:08:00.000Z" },
  { id: "demo-007", leadId: "ld-011", businessName: "Wolters Schilders", industry: "Schilders", city: "Haarlem", template: "home_improvement", status: "failed", generationStatus: "failed", headline: "Vakwerk voor iedere wand en gevel", description: "Wolters Schilders verzorgt binnen- en buitenschilderwerk in Haarlem en omstreken. Snel, netjes en met hoogwaardige materialen.", services: ["Binnenschilderwerk", "Buitschilderwerk", "Kozijnen", "Behangwerk"], ctaText: "Vraag een gratis kleuradvies aan", notes: "Generatie mislukt — opnieuw proberen in latere fase.", createdAt: "2026-09-11T16:20:00.000Z", updatedAt: "2026-09-13T09:40:00.000Z" },
  { id: "demo-008", leadId: "ld-012", businessName: "De Roode Dakwerken", industry: "Dakwerken", city: "Enschede", template: "home_improvement", status: "ready", generationStatus: "completed", headline: "Kwaliteitsdakwerk in Enschede en omstreken", description: "De Roode Dakwerken is met 200+ reviews een van de best beoordeelde dakdekkers van Overijssel. Nieuwe daken, renovatie en onderhoud.", services: ["Nieuwe daken", "Dakrenovatie", "Onderhoud en reparatie", "Dakisolatie"], ctaText: "Plan een gratis dakinspectie", notes: "", createdAt: "2026-09-06T18:05:00.000Z", updatedAt: "2026-09-14T08:20:00.000Z" },
];

export const demos: DemoWebsite[] = rawDemos.map((demo) => ({
  ...demo,
  slug: slugify(demo.businessName),
  previewUrl: `/demo/${slugify(demo.businessName)}`,
}));

// Slug-uniekheid afgedwongen — dubbele slugs zijn een programmeerfout.
const seenSlugs = new Set<string>();
for (const demo of demos) {
  if (seenSlugs.has(demo.slug)) {
    throw new Error(`Dubbele demo-slug: ${demo.slug}`);
  }
  seenSlugs.add(demo.slug);
}

export function demoByLeadId(leadId: string): DemoWebsite | undefined {
  return demos.find((demo) => demo.leadId === leadId);
}

export function demoBySlug(slug: string): DemoWebsite | undefined {
  return demos.find((demo) => demo.slug === slug);
}

export function demoStatusForLead(leadId: string): DemoStatus {
  return demoByLeadId(leadId)?.status ?? "not_created";
}

export const demoTemplatesUsed: DemoTemplate[] = Array.from(
  new Set(demos.map((demo) => demo.template))
);
