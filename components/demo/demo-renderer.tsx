import { demoTemplates } from "@/lib/demo-templates";
import type { DemoWebsite, Lead } from "@/lib/types";
import { DemoAbout } from "./demo-about";
import { DemoContact } from "./demo-contact";
import { DemoCta } from "./demo-cta";
import { DemoFooter } from "./demo-footer";
import { DemoHeader } from "./demo-header";
import { DemoHero } from "./demo-hero";
import { DemoServices } from "./demo-services";

/**
 * DemoRenderer — rendert een demo-website via het templatesysteem.
 * Nieuwe templates voeg je toe in lib/demo-templates.ts; deze renderer
 * en de /demo/[slug]-route hoeven dan niet te worden aangepast.
 */
export function DemoRenderer({ demo, lead }: { demo: DemoWebsite; lead: Lead }) {
  const template = demoTemplates[demo.template] ?? demoTemplates.business_standard;

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800">
        Vrijblijvend demo-concept van Silvijn Studio. Geen gepubliceerde klantwebsite.
      </div>

      <DemoHeader demo={demo} accent={template.accent} />
      <DemoHero demo={demo} lead={lead} hero={template.hero} />

      {template.sectionOrder.map((section) => {
        switch (section) {
          case "services":
            return <DemoServices key="services" demo={demo} accent={template.accent} />;
          case "about":
            return <DemoAbout key="about" demo={demo} lead={lead} />;
          case "cta":
            return <DemoCta key="cta" demo={demo} lead={lead} accent={template.accent} />;
          default:
            return null;
        }
      })}

      <DemoContact demo={demo} lead={lead} />
      <DemoFooter demo={demo} />
    </div>
  );
}
