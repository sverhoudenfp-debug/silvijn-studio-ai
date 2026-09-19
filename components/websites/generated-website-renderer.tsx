import Link from "next/link";
import type { GeneratedSectionData, GeneratedWebsite } from "@/lib/websites/types";

/**
 * GeneratedWebsiteRenderer (Fase 9) — rendert een gegenereerde website
 * uitsluitend via deze VOORAF GECONTROLEERDE componenten. De data komt uit
 * de deterministische generator (gestructureerde section-data); er wordt
 * nooit AI-code of vrije code uitgevoerd. Mobile-first, responsive,
 * zelfde stylingpatronen als het demo-systeem (Fase 3).
 */

function asRecord(data: Record<string, unknown>): Record<string, unknown> {
  return data ?? {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

interface ServiceItem {
  title: string;
  description: string | null;
}
interface FaqItem {
  question: string;
  answer: string;
}

function isPlaceholder(value: string): boolean {
  return value.includes("[INFORMATIE ONBEKEND]") || value.includes("TESTDATA");
}

function PlaceholderText({ value }: { value: string }) {
  if (isPlaceholder(value)) {
    return (
      <span className="italic text-zinc-400">
        {value.replace("TESTDATA (mock): ", "")} — wordt aangevuld zodra de informatie beschikbaar is.
      </span>
    );
  }
  return <>{value}</>;
}

function HeaderSection({ data }: { data: Record<string, unknown> }) {
  const d = asRecord(data);
  const navigation = Array.isArray(d.navigation) ? (d.navigation as string[]) : [];
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <span className="text-lg font-bold tracking-tight text-zinc-900">{str(d.businessName) || "Website"}</span>
        <nav className="hidden items-center gap-6 text-sm text-zinc-600 md:flex">
          {navigation.map((item) => (
            <span key={item} className="hover:text-zinc-900">{item}</span>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          {strOrNull(d.phone) && (
            <a href={`tel:${str(d.phone)}`} className="hidden text-sm font-medium text-zinc-700 sm:block">
              {str(d.phone)}
            </a>
          )}
          {strOrNull(d.ctaText) && (
            <span className={`rounded-lg ${str(d.accent) || "bg-zinc-800"} px-4 py-2 text-sm font-semibold text-white`}>
              {str(d.ctaText)}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

function HeroSection({ data }: { data: Record<string, unknown> }) {
  const d = asRecord(data);
  const ctaPrimary = strOrNull(d.ctaPrimary);
  const ctaSecondary = strOrNull(d.ctaSecondary);
  const imagePlaceholder = strOrNull(d.imagePlaceholder);
  return (
    <section className={`bg-gradient-to-br ${str(d.gradient) || "from-zinc-800 to-zinc-950"} text-white`}>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 md:grid-cols-2 md:py-24">
        <div className="flex flex-col justify-center">
          <h1 className="text-3xl font-bold leading-tight sm:text-4xl md:text-5xl">{str(d.headline)}</h1>
          {strOrNull(d.subheadline) && (
            <p className="mt-4 text-lg leading-relaxed text-zinc-200">{str(d.subheadline)}</p>
          )}
          {strOrNull(d.valueProposition) && (
            <p className="mt-2 text-base text-zinc-300">{str(d.valueProposition)}</p>
          )}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {ctaPrimary && (
              <span className={`inline-flex justify-center rounded-lg ${str(d.accent) || "bg-white text-zinc-900"} px-6 py-3 text-sm font-semibold`}>
                {ctaPrimary}
              </span>
            )}
            {ctaSecondary && (
              <span className="inline-flex justify-center rounded-lg border border-white/30 px-6 py-3 text-sm font-semibold text-white">
                {ctaSecondary}
              </span>
            )}
          </div>
          {strOrNull(d.city) && (
            <p className="mt-6 text-sm text-zinc-300">
              Actief in {str(d.city)}
              {strOrNull(d.province) ? ` en omgeving (${str(d.province)})` : " en omgeving"}
            </p>
          )}
        </div>
        <div className="flex items-center justify-center">
          <div className="flex aspect-[4/3] w-full max-w-md items-center justify-center rounded-2xl border border-white/20 bg-white/10 p-6 text-center">
            <p className="text-sm text-zinc-200">
              {imagePlaceholder ?? "Hero-afbeelding (placeholder)"}
              <span className="mt-2 block text-xs text-zinc-400">Afbeelding volgt zodra beschikbaar</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ServicesSection({ data }: { data: Record<string, unknown> }) {
  const d = asRecord(data);
  const services = (Array.isArray(d.services) ? d.services : []) as ServiceItem[];
  if (services.length === 0) return null;
  return (
    <section className="bg-white py-14 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-2xl font-bold text-zinc-900 sm:text-3xl">Diensten</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => (
            <div key={service.title} className="rounded-xl border border-zinc-200 bg-zinc-50 p-5">
              <h3 className="text-lg font-semibold text-zinc-900">{service.title}</h3>
              {service.description && (
                <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                  <PlaceholderText value={service.description} />
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AboutSection({ data }: { data: Record<string, unknown> }) {
  const d = asRecord(data);
  const about = strOrNull(d.about);
  const benefits = (Array.isArray(d.benefits) ? d.benefits : []) as string[];
  return (
    <section className="bg-zinc-50 py-14 sm:py-16">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 md:grid-cols-2">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900 sm:text-3xl">Over ons</h2>
          {about ? (
            <p className="mt-4 text-base leading-relaxed text-zinc-700">
              <PlaceholderText value={about} />
            </p>
          ) : (
            <p className="mt-4 text-base text-zinc-500">
              [INFORMATIE ONBEKEND] — bedrijfsbeschrijving volgt zodra aangeleverd.
            </p>
          )}
          {strOrNull(d.targetAudience) && (
            <p className="mt-3 text-sm text-zinc-600">Wij werken voor: {str(d.targetAudience)}</p>
          )}
        </div>
        {benefits.length > 0 && (
          <ul className="space-y-3 md:border-l md:border-zinc-200 md:pl-8">
            {benefits.map((benefit) => (
              <li key={benefit} className="flex items-start gap-3 text-base text-zinc-700">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${str(d.accent) || "bg-zinc-700"}`} />
                <PlaceholderText value={benefit} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * R1 — Galerij-preview: abstracte beeldvlakken (geen stock-foto's, geen
 * gesimuleerde foto-content). Bijschriften volgen de AI-planning of blijven weg.
 */
function GallerySection({ data }: { data: Record<string, unknown> }) {
  const d = asRecord(data);
  const captions = (Array.isArray(d.captions) ? d.captions : []) as (string | null)[];
  if (captions.length === 0) return null;
  return (
    <section className="bg-white py-14 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-2xl font-bold text-zinc-900 sm:text-3xl">Impressie</h2>
        <p className="mt-2 text-sm text-zinc-500">
          Beeldsloten — echte foto&apos;s volgen zodra ze beschikbaar zijn (abstracte voorbeeldopbouw).
        </p>
        <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-3">
          {captions.map((caption, i) => (
            <figure key={i} className="overflow-hidden rounded-xl border border-zinc-200">
              <div className="flex aspect-square items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200">
                <span className="h-10 w-10 rounded-full bg-zinc-300/70" aria-hidden="true" />
              </div>
              {caption && <figcaption className="px-3 py-2 text-xs text-zinc-600">{caption}</figcaption>}
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * R1 — Testimonials-preview: uitsluitend echte, uit de specificatie bekende
 * uitspraken; geen verzonnen namen, quotes of gezichten.
 */
function TestimonialsSection({ data }: { data: Record<string, unknown> }) {
  const d = asRecord(data);
  const quotes = (Array.isArray(d.quotes) ? d.quotes : []) as string[];
  if (quotes.length === 0) return null;
  return (
    <section className="bg-zinc-50 py-14 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-2xl font-bold text-zinc-900 sm:text-3xl">Wat klanten zeggen</h2>
        <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {quotes.map((quote, i) => (
            <blockquote key={i} className="rounded-xl border border-zinc-200 bg-white p-5">
              <span className="block font-serif text-3xl leading-none text-indigo-400" aria-hidden="true">&ldquo;</span>
              <p className="mt-2 text-sm leading-relaxed text-zinc-700">{quote}</p>
            </blockquote>
          ))}
        </div>
      </div>
    </section>
  );
}

function BenefitsSection({ data }: { data: Record<string, unknown> }) {
  const d = asRecord(data);
  const benefits = (Array.isArray(d.benefits) ? d.benefits : []) as string[];
  if (benefits.length === 0) return null;
  return (
    <section className="bg-white py-14 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-2xl font-bold text-zinc-900 sm:text-3xl">Waarom kiezen voor ons</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {benefits.map((benefit) => (
            <div key={benefit} className="rounded-xl border border-zinc-200 p-5">
              <p className="text-base text-zinc-700"><PlaceholderText value={benefit} /></p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FaqSection({ data }: { data: Record<string, unknown> }) {
  const d = asRecord(data);
  const items = (Array.isArray(d.items) ? d.items : []) as FaqItem[];
  if (items.length === 0) return null;
  return (
    <section className="bg-zinc-50 py-14 sm:py-16">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h2 className="text-2xl font-bold text-zinc-900 sm:text-3xl">Veelgestelde vragen</h2>
        <div className="mt-8 space-y-4">
          {items.map((item) => (
            <details key={item.question} className="rounded-xl border border-zinc-200 bg-white p-4">
              <summary className="cursor-pointer text-base font-semibold text-zinc-900">{item.question}</summary>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600"><PlaceholderText value={item.answer} /></p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaSection({ data }: { data: Record<string, unknown> }) {
  const d = asRecord(data);
  return (
    <section className={`bg-gradient-to-br ${str(d.accent) || "bg-zinc-800"} py-14 text-center sm:py-16`}>
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h2 className="text-2xl font-bold text-white sm:text-3xl">{str(d.headline) || "Neem contact op"}</h2>
        {strOrNull(d.secondary) && <p className="mt-3 text-base text-zinc-100">{str(d.secondary)}</p>}
        {d.leadCapture === true && (
          <p className="mt-4 text-sm text-zinc-100">Gebruik het contactformulier hieronder — we reageren snel.</p>
        )}
      </div>
    </section>
  );
}

function ContactSection({ data }: { data: Record<string, unknown> }) {
  const d = asRecord(data);
  const phone = strOrNull(d.phone);
  const email = strOrNull(d.email);
  const address = strOrNull(d.address);
  const methods = (Array.isArray(d.methods) ? d.methods : []) as string[];
  return (
    <section className="bg-white py-14 sm:py-16">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 md:grid-cols-2">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900 sm:text-3xl">Contact</h2>
          {strOrNull(d.intro) && <p className="mt-4 text-base text-zinc-600">{str(d.intro)}</p>}
          <div className="mt-6 space-y-3 text-sm text-zinc-700">
            {phone && (
              <p>
                Telefoon:{" "}
                <a href={`tel:${phone}`} className="font-medium text-zinc-900 underline underline-offset-2">
                  {phone}
                </a>
              </p>
            )}
            {email && (
              <p>
                E-mail:{" "}
                <a href={`mailto:${email}`} className="font-medium text-zinc-900 underline underline-offset-2">
                  {email}
                </a>
              </p>
            )}
            {address && (
              <p>
                Bezoekadres: {address}, {str(d.city)}
              </p>
            )}
            {!phone && !email && (
              <p className="text-zinc-500">Echte contactgegevens volgen zodra beschikbaar — gebruik het formulier.</p>
            )}
            {methods.length > 0 && <p className="text-zinc-500">Contact via: {methods.join(" · ")}</p>}
          </div>
        </div>
        {d.leadCapture === true && (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-6">
            <p className="text-base font-semibold text-zinc-900">Contactformulier</p>
            <div className="mt-4 space-y-3">
              <div className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm leading-10 text-zinc-400">Uw naam</div>
              <div className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm leading-10 text-zinc-400">Uw e-mailadres</div>
              <div className="h-24 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-400">Uw bericht</div>
              <div className="h-10 rounded-lg bg-zinc-800 px-4 text-center text-sm font-semibold leading-10 text-white">Verstuur bericht</div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function FooterSection({ data }: { data: Record<string, unknown> }) {
  const d = asRecord(data);
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-zinc-200 bg-zinc-950 py-10 text-zinc-400">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <p className="font-semibold text-zinc-200">{str(d.businessName) || "Website"}</p>
          <p className="mt-1">
            {str(d.city)}
            {strOrNull(d.seoLocalArea) && ` · regio ${str(d.seoLocalArea)}`}
          </p>
        </div>
        <div className="space-y-1">
          {strOrNull(d.phone) && <p>Telefoon: {str(d.phone)}</p>}
          {strOrNull(d.email) && <p>E-mail: {str(d.email)}</p>}
          <p className="text-zinc-500">© {year}</p>
        </div>
      </div>
    </footer>
  );
}

export function GeneratedWebsiteRenderer({ website }: { website: GeneratedWebsite }) {
  const sections = website.generatedContent?.sections ?? [];

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800">
        Gegenereerde website · READY FOR QC · nog niet live —{" "}
        <Link href={`/projects/${website.projectId}`} className="font-medium underline underline-offset-2">
          terug naar het project
        </Link>
      </div>

      {sections.map((section) => (
        <SectionComponent key={section.type} section={section} />
      ))}
    </div>
  );
}

function SectionComponent({ section }: { section: GeneratedSectionData }) {
  const data = section.data ?? {};
  switch (section.type) {
    case "header":
      return <HeaderSection data={data} />;
    case "hero":
      return <HeroSection data={data} />;
    case "services":
      return <ServicesSection data={data} />;
    case "about":
      return <AboutSection data={data} />;
    case "gallery":
      return <GallerySection data={data} />;
    case "testimonials":
      return <TestimonialsSection data={data} />;
    case "benefits":
      return <BenefitsSection data={data} />;
    case "faq":
      return <FaqSection data={data} />;
    case "cta":
      return <CtaSection data={data} />;
    case "contact":
      return <ContactSection data={data} />;
    case "footer":
      return <FooterSection data={data} />;
    default:
      return null;
  }
}
