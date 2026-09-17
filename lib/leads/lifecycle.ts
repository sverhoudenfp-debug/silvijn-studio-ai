import edges from "./lifecycle.json";
import type { BadgeVariant } from "@/lib/types";
export type LeadLifecycleStatus = keyof typeof edges;
export const leadLifecycleStates = Object.keys(edges) as LeadLifecycleStatus[];
export function nextLeadStates(status: LeadLifecycleStatus): LeadLifecycleStatus[] { return edges[status] as LeadLifecycleStatus[]; }
export function isLeadTransitionAllowed(from: LeadLifecycleStatus, to: LeadLifecycleStatus) { return from === to || (edges[from] as string[]).includes(to); }
export const leadLifecycleMeta = Object.fromEntries(leadLifecycleStates.map(state => [state, {
  label: state.toUpperCase().replaceAll("_", " "),
  variant: (["lost","not_interested","opted_out"].includes(state) ? "danger" : ["silvijn_approval","ready_for_silvijn","payment_pending","final_payment_pending"].includes(state) ? "warning" : ["paid","paid_in_full","approved","delivered","won"].includes(state) ? "success" : state === "new" ? "neutral" : "info") as BadgeVariant,
}])) as Record<LeadLifecycleStatus, { label: string; variant: BadgeVariant }>;

/** Preparing a quotation does not approve a price or authorize production. */
export function canCreateProjectForLead(status:string) { return ["qualified","interested","contacted","website_interested","qualifying"].includes(status); }
export function isOutreachSuppressed(status:string,outreachStatus:string) { return ["opted_out","not_interested","lost"].includes(status)||outreachStatus==="opted_out"; }
