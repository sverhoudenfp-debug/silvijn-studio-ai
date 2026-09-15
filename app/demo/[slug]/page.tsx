import Link from "next/link";
import { notFound } from "next/navigation";
import { leads } from "@/lib/mock-data";
import { slugify } from "@/lib/utils";

/**
 * Demo Website System — iedere lead krijgt een automatisch gegenereerde,
 * gepersonaliseerde demo-website op /demo/[slug], zonder apart domein.
 * In deze fase wordt de demo opgebouwd uit leaddata; later kan de
 * Demo Website Agent volledige maatwerk-content genereren.
 */

const servicesByCategory: Record<string, string[]> = {
  Dakdekkers: ["Nieuwe daken", "Dakrenovatie", "Onderhoud en reparatie", "Dakisolatie"],
  Loodgieters: ["Loodgieterswerk", "Ontstoppen", "Lekkages oplossen", "Sanitair installeren"],
  Kappers: ["Knippen", "Kleuring", "Brushing", "Advies op maat"],
  Hoveniers: ["Tuinonderhoud", "Tuinaanleg", "Snoeiwerk", "Bestrating"],
  Elektriciens: ["Installatiewerk", "Storingen oplossen", "Verlichting", "Veiligheidskeuring"],
  Schilders: ["Binnenschilderwerk", "Buitschilderwerk", "Kozijnen", "Behangwerk"],
  Garages: ["Onderhoud en reparatie", "APK-keuring", "Bandenservice", "Airco-service"],
  Schoonheidssalons: ["Huidverzorging", "Nagelstudio", "Wimperextensions", "Bruidsstyling"],
  Restaurants: ["Lunch", "Diner", "Catering", "Arrangementen"],
  Schoonmaak: ["Kantoorreiniging", "Glasbewassing", "Onderhoud", "Specialistisch reinigen"],
};

const defaultServices = ["Vakkundige service", "Offerte op maat", "Snelle reactietijd", "Persoonlijk advies"];

const palettes: Record<string, { hero: string; accent: string }> = {
  Dakdekkers: { hero: "from-stone-700 to-stone-950", accent: "bg-amber-600" },
  Loodgieters: { hero: "from-sky-800 to-slate-950", accent: "bg-sky-600" },
  Kappers: { hero: "from-rose-800 to-zinc-950", accent: "bg-rose-500" },
  Hoveniers: { hero: "from-emerald-800 to-zinc-950", accent: "bg-emerald-600" },
  Elektriciens: { hero: "from-indigo-800 to-zinc-950", accent: "bg-indigo-500" },
  Schilders: { hero: "from-orange-800 to-zinc-950", accent: "bg-orange-600" },
  Garages: { hero: "from-zinc-700 to-zinc-950", accent: "bg-red-600" },
  Schoonheidssalons: { hero: "from-pink-800 to-zinc-950", accent: "bg-pink-500" },
  Restaurants: { hero: "from-amber-800 to-zinc-950", accent: "bg-amber-700" },
  Schoonmaak: { hero: "from-cyan-800 to-zinc-950", accent: "bg-cyan-600" },
};

const defaultPalette = { hero: "from-zinc-700 to-zinc-950", accent: "bg-indigo-600" };

export function generateStaticParams() {
  return leads.map((lead) => ({ slug: slugify(lead.name) }));
}

export default async function DemoPage(props: PageProps<"/demo/[slug]">) {
  const { slug } = await props.params;
  const lead = leads.find((item) => slugify(item.name) === slug);
  if (!lead) notFound();

  const services = servicesByCategory[lead.category] ?? defaultServices;
  const palette = palettes[lead.category] ?? defaultPalette;
  const initials = lead.name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800">
        Demo website — automatisch gegenereerd door Silvijn Studio ·{" "}
        <Link href="/dashboard" className="font-medium underline underline-offset-2">
          Terug naar dashboard
        </Link>
      </div>

      <header className="border-b border-zinc-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${palette.accent} text-sm font-bold text-white`}>
              {initials}
            </span>
            <span className="font-semibold tracking-tight">{lead.name}</span>
          </div>
          <nav className="hidden gap-6 text-sm text-zinc-600 sm:flex">
            <a href="#diensten" className="hover:text-zinc-900">Diensten</a>
            <a href="#reviews" className="hover:text-zinc-900">Reviews</a>
            <a href="#contact" className="hover:text-zinc-900">Contact</a>
          </nav>
        </div>
      </header>

      <section className={`bg-gradient-to-br ${palette.hero} text-white`}>
        <div className="mx-auto max-w-5xl px-6 py-20 text-center">
          <p className="text-sm font-medium uppercase tracking-widest text-white/70">
            {lead.category} · {lead.location}
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">{lead.name}</h1>
          <p className="mx-auto mt-4 max-w-xl text-white/80">
            {lead.category} in {lead.location} met {lead.reviewCount ?? 0} tevreden klanten. Bekijk onze
            diensten en neem vrijblijvend contact op.
          </p>
          {lead.rating ? (
            <p className="mt-4 text-sm text-white/80">
              ★ {lead.rating.toFixed(1)} · {lead.reviewCount} reviews
            </p>
          ) : null}
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {lead.email ? (
              <a
                href={`mailto:${lead.email}?subject=Offerte via de website`}
                className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-zinc-900 transition-opacity hover:opacity-90"
              >
                Vraag een offerte aan
              </a>
            ) : null}
            <a
              href="#diensten"
              className="rounded-lg border border-white/40 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              Bekijk onze diensten
            </a>
          </div>
        </div>
      </section>

      <section id="diensten" className="mx-auto max-w-5xl scroll-mt-20 px-6 py-16">
        <h2 className="text-center text-2xl font-bold tracking-tight">Onze diensten</h2>
        <p className="mx-auto mt-2 max-w-lg text-center text-sm text-zinc-500">
          Professioneel uitgevoerd in {lead.location} en omgeving.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {services.map((service) => (
            <div key={service} className="rounded-xl border border-zinc-200 p-5 transition-colors hover:border-zinc-400">
              <span className={`block h-8 w-8 rounded-lg ${palette.accent}`} />
              <p className="mt-3 text-sm font-semibold">{service}</p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                Vakkundig werk met garantie en heldere afspraken.
              </p>
            </div>
          ))}
        </div>
      </section>

      <section id="reviews" className="scroll-mt-20 border-y border-zinc-200 bg-zinc-50">
        <div className="mx-auto max-w-5xl px-6 py-16 text-center">
          <p className="text-5xl font-bold tracking-tight">{lead.rating ? lead.rating.toFixed(1) : "—"}</p>
          <p className="mt-1 text-sm text-zinc-500">op basis van {lead.reviewCount ?? 0} reviews</p>
          <p className="mx-auto mt-6 max-w-xl text-sm leading-relaxed text-zinc-600">
            Onze klanten waarderen ons om kwaliteit, betrouwbaarheid en service. Wij zijn trots op onze
            reputatie in {lead.location} en omstreken.
          </p>
        </div>
      </section>

      <section id="contact" className="mx-auto max-w-5xl scroll-mt-20 px-6 py-16">
        <h2 className="text-center text-2xl font-bold tracking-tight">Neem contact op</h2>
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="space-y-3 text-sm text-zinc-600">
            <p>Bel of mail ons — wij reageren meestal binnen een dag.</p>
            {lead.phone ? (
              <p>
                Telefoon:{" "}
                <a href={`tel:${lead.phone.replace(/\s/g, "")}`} className="font-medium text-zinc-900 underline underline-offset-2">
                  {lead.phone}
                </a>
              </p>
            ) : null}
            {lead.email ? (
              <p>
                E-mail:{" "}
                <a href={`mailto:${lead.email}`} className="font-medium text-zinc-900 underline underline-offset-2">
                  {lead.email}
                </a>
              </p>
            ) : null}
            <p>{lead.location}</p>
          </div>
          <div className="rounded-xl bg-zinc-50 p-6">
            <p className="text-sm font-semibold text-zinc-900">Waarom {lead.name}?</p>
            <ul className="mt-3 space-y-2 text-sm text-zinc-600">
              <li>✓ {lead.rating ?? "Hoge"} klantbeoordeling</li>
              <li>✓ {lead.reviewCount ?? "Veel"} tevreden klanten</li>
              <li>✓ Actief in {lead.location} en omgeving</li>
              <li>✓ Heldere prijzen en snelle reactie</li>
            </ul>
          </div>
        </div>
      </section>

      <footer className="border-t border-zinc-200 bg-zinc-50">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-6 py-6 text-xs text-zinc-500 sm:flex-row">
          <p>© {new Date().getFullYear()} {lead.name} · {lead.location}</p>
          <p>
            Demo website door{" "}
            <span className="font-medium text-zinc-800">Silvijn Studio</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
