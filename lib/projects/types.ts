/**
 * Project-domein types (Fase 8). Een project ontstaat uit een gekwalificeerde
 * lead via een expliciete user action — de AI start nooit zelf een project.
 * AI zet ook nooit APPROVED/IN_PROGRESS/COMPLETED: die statussen zijn
 * voorbehouden aan menselijke acties.
 */

export type ProjectStatus =
  | "quotation_pending" // project aangemaakt, prijs nog niet klaar
  | "price_ready" // prijsindicatie berekend, wacht op mens
  | "awaiting_approval" // intern naar Silvijn geëscaleerd ("Send to Silvijn")
  | "approved" // mens heeft goedgekeurd (NOOIT automatisch)
  | "in_progress" // mens heeft gestart (NOOIT automatisch)
  | "ready_for_review" // klaar voor eindreview (mens)
  | "completed" // afgerond (NOOIT automatisch)
  | "cancelled";

/** Statussen die ALLEEN door een mens mogen worden gezet. */
export const HUMAN_ONLY_PROJECT_STATUSES: ProjectStatus[] = [
  "approved",
  "in_progress",
  "ready_for_review",
  "completed",
];

export type PriceStatus =
  | "not_calculated"
  | "calculating"
  | "ready"
  | "missing_information"
  | "configuration_missing"
  | "requires_human"
  | "approved" // prijsindicatie door mens goedgekeurd
  | "rejected"; // prijsindicatie door mens afgewezen

export interface ProjectRequirements {
  // Alle velden optioneel/nullable: onbekende informatie is UNKNOWN — nooit gokken.
  websiteType?: string | null; // bijv. one-pager, business_website, webshop
  numberOfPages?: number | null;
  designLevel?: string | null; // bijv. basic, standard, premium
  responsive?: boolean | null;
  cms?: boolean | null;
  ecommerce?: boolean | null;
  customFunctionality?: string | null;
  integrations?: string[] | null;
  seo?: boolean | null;
  copywriting?: boolean | null;
  photography?: boolean | null;
  hosting?: boolean | null;
  maintenance?: boolean | null;
  deadline?: string | null;
  existingWebsite?: boolean | null;
  existingBranding?: boolean | null;
  contentAvailable?: boolean | null;
  specialRequirements?: string | null;
}

export interface Project {
  id: string;
  leadId: string;
  name: string;
  status: ProjectStatus;
  projectType: string | null;
  description: string;
  requirements: ProjectRequirements;
  estimatedPrice: number | null;
  priceStatus: PriceStatus;
  currency: string;
  timeline: string | null;
  notes: string;
  /** Fase I.1: alléén zetbaar via de owner-RPC set_project_requirements_complete. */
  requirementsComplete: boolean;
  createdAt: string;
  updatedAt: string;
}
