import "server-only";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { getProjectRepository } from "@/lib/projects/repository";
import { getDemoRepository } from "@/lib/repositories/demo-repository";
import { getInboundMessageRepository, getSalesInteractionRepository } from "@/lib/sales/repository";
import { getOutreachRepository } from "@/lib/outreach/repository";

/**
 * Contextbouwer voor de questionnaire-agent. Verzamelt ALLE betrouwbare
 * informatie die al over de lead/klant bekend is, zodat:
 *  1) de AI geen vragen stelt die al beantwoord zijn;
 *  2) de completion-analyse veilig informatie kan herleiden (nooit verzinnen).
 * Alleen ECHTE opgeslagen bronnen: leadgegevens, AI-analyse van de lead,
 * bevestigde inbound-berichten, sales-analyses, verzonden outreach,
 * bestaande demo en projectgegevens. Alles is interne context — de publieke
 * questionnaire toont hier nooit iets van.
 */

export interface QuestionnaireContext {
  businessName: string;
  /** Compacte, actieve samenvatting voor de AI-prompt. */
  summary: string;
  /** Snapshot voor intern gebruik: welke bronnen zijn gebruikt (auditbaar). */
  aiContext: Record<string, unknown>;
}

export class QuestionnaireContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionnaireContextError";
  }
}

function sanitize(value: string | null | undefined, max = 500): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export async function buildQuestionnaireContext(
  leadId: string,
  projectId?: string | null
): Promise<QuestionnaireContext> {
  const lead = await getLeadRepository().get(leadId);
  if (!lead) throw new QuestionnaireContextError("Lead niet gevonden");

  const [project, demo, inbound, interactions, outreach] = await Promise.all([
    projectId
      ? getProjectRepository().getById(projectId)
      : getProjectRepository().getByLeadId(leadId),
    getDemoRepository().findByLeadId(leadId),
    getInboundMessageRepository().listByLead(leadId),
    getSalesInteractionRepository().listByLead(leadId),
    getOutreachRepository().listByLead(leadId),
  ]);

  const lines: string[] = [
    `Bedrijf: ${sanitize(lead.businessName, 120)}`,
    `Branche: ${sanitize(lead.industry, 80)}`,
    `Locatie: ${sanitize(lead.city, 60)}${lead.province ? ` (provincie ${sanitize(lead.province, 40)})` : ""}`,
    lead.phone ? `Telefoon: ${sanitize(lead.phone, 30)}` : "Telefoon: onbekend",
    lead.email ? `E-mail: ${sanitize(lead.email, 120)}` : "E-mail: onbekend",
    `Huidige website: ${lead.website ? sanitize(lead.website, 200) : "geen website bekend"}`,
  ];

  const sources: string[] = ["lead"];

  if (lead.aiAnalysis) {
    sources.push("lead_ai_analysis");
    lines.push("", "AI-ANALYSE VAN DIT BEDRIJF (bestaand):");
    lines.push(sanitize(lead.aiAnalysis.businessSummary, 400));
    lines.push(`Aanbevolen aanpak: ${sanitize(lead.aiAnalysis.recommendedApproach, 400)}`);
  }

  const confirmedInbound = inbound.filter((m) => m.body?.trim()).slice(-3);
  if (confirmedInbound.length > 0) {
    sources.push("confirmed_inbound_messages");
    lines.push("", "BEVESTIGDE REACTIES VAN DE KLANT (chronologisch):");
    for (const message of confirmedInbound) {
      lines.push(
        `- (${message.receivedAt?.slice(0, 10) ?? message.createdAt?.slice(0, 10) ?? "datum onbekend"}) ${sanitize(message.body, 600)}`
      );
    }
  }

  const latestQualification = interactions[0]?.qualification;
  if (latestQualification) {
    sources.push("sales_analysis");
    lines.push("", "SALES-KWALIFICATIE (intern, uit eerdere analyse):");
    if (latestQualification.projectType) lines.push(`Soort project: ${sanitize(latestQualification.projectType, 120)}`);
    if (latestQualification.timeline) lines.push(`Gewenste timing: ${sanitize(latestQualification.timeline, 120)}`);
    if (latestQualification.missingInformation?.length) {
      lines.push(`Toen al bekende hiaten: ${latestQualification.missingInformation.slice(0, 6).map((m) => sanitize(m, 200)).join("; ")}`);
    }
  }

  const sentOutreach = outreach.filter((d) => d.status === "sent").slice(-2);
  if (sentOutreach.length > 0) {
    sources.push("sent_outreach");
    lines.push("", "EERDER VERZONDEN BERICHTEN AAN DEZE KLANT (chronologisch):");
    for (const draft of sentOutreach) {
      lines.push(sanitize(draft.body, 400));
    }
  }

  if (demo) {
    sources.push("demo_website");
    lines.push("", `DEMO-WEBSITE BESTAAT: ${sanitize(demo.headline, 200)}`);
  }

  if (project) {
    sources.push("project");
    lines.push("", "PROJECTINFORMATIE (intern):");
    lines.push(`Naam: ${sanitize(project.name, 120)}`);
    lines.push(`Status: ${project.status}`);
    if (project.projectType) lines.push(`Type: ${sanitize(project.projectType, 80)}`);
    if (project.timeline) lines.push(`Timeline: ${sanitize(project.timeline, 120)}`);
    const req = project.requirements as Record<string, unknown>;
    const knownReq = Object.entries(req ?? {})
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : sanitize(String(v), 120)}`);
    if (knownReq.length > 0) lines.push(`Bekende requirements: ${knownReq.join("; ").slice(0, 800)}`);
  }

  if (lead.notes.length > 0) {
    sources.push("lead_notes");
    lines.push("", "INTERNE NOTITIES (context only):");
    for (const note of lead.notes.slice(-5)) lines.push(`- ${sanitize(note, 300)}`);
  }

  return {
    businessName: lead.businessName,
    summary: lines.join("\n"),
    aiContext: { sources, generatedAt: new Date().toISOString() },
  };
}
