"use server";

import { revalidatePath } from "next/cache";
import { requireStudioOwner } from "@/lib/auth/server";
import { DemoGenerationError, generateDemoPageForLead } from "@/lib/demos/demo-generation";
import { getDemoRepository } from "@/lib/repositories/demo-repository";
import { getLeadRepository } from "@/lib/repositories/lead-repository";

export type GenerateDemoResult =
  | { ok: true; previewUrl: string; sha256: string; missingInformation: string[] }
  | { ok: false; error: string };

/**
 * G4 — Owner-commando: genereer de gratis één-pagina-demo voor een lead.
 * Alleen de studio-eigenaar. Verandert geen leadstatus, prijs of betaling;
 * outreach blijft een aparte, expliciete stap.
 */
export async function generateDemoForLead(leadId: string): Promise<GenerateDemoResult> {
  await requireStudioOwner();
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(leadId)) return { ok: false, error: "Ongeldige lead-id." };
  const lead = await getLeadRepository().get(leadId);
  if (!lead) return { ok: false, error: "Lead niet gevonden." };
  try {
    const page = await generateDemoPageForLead(lead);
    const repo = getDemoRepository();
    const clash = await repo.findBySlug(page.slug);
    const slug = clash && clash.leadId !== lead.id ? `${page.slug}-${lead.id.slice(0, 6).toLowerCase()}` : page.slug;
    const demo = await repo.upsertThemeDemo({
      leadId: lead.id,
      slug,
      businessName: lead.businessName,
      industry: lead.industry,
      city: lead.city,
      headline: page.headline,
      description: page.description,
      ctaText: "Neem contact op",
      notes: page.missingInformation.join("\n"),
      renderedHtml: page.html,
      themeSha256: page.sha256,
      generationNotes: [...page.notes, `sections: ${page.sectionTypes.join(",")}`],
    });
    revalidatePath(`/leads/${lead.id}`);
    revalidatePath(`/demo/${demo.slug}`);
    revalidatePath("/demo-websites");
    return { ok: true, previewUrl: demo.previewUrl, sha256: page.sha256, missingInformation: page.missingInformation };
  } catch (error) {
    if (error instanceof DemoGenerationError) return { ok: false, error: `${error.code}: ${error.message}` };
    if (error instanceof Error && error.name === "ThemeHtmlPreviewError") return { ok: false, error: `RENDER_FAILED: ${error.message}` };
    throw error;
  }
}
