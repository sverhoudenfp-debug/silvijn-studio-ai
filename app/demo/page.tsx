/**
 * Publieke demo-landingspagina — zichtbaar op het hoofddomein én op
 * demo.silvijnstudio.com/. Bevat geen klant-, lead- of dashboarddata.
 */

export const dynamic = "force-dynamic";

export default function DemoHome() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-zinc-100">
      <section className="w-full max-w-xl rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Silvijn Studio</p>
        <h1 className="mt-2 text-2xl font-semibold">Voorbeeldwebsites</h1>
        <p className="mt-3 text-sm text-zinc-400">
          Op dit adres delen wij vrijblijvende demo-concepten. Elke demo heeft een persoonlijke link in de vorm
          van <span className="text-zinc-200">demo.silvijnstudio.com/jouw-bedrijf</span>.
        </p>
        <p className="mt-3 text-sm text-zinc-400">
          Geen link ontvangen of werkt deze niet? Neem contact op met Silvijn Studio.
        </p>
      </section>
    </main>
  );
}
