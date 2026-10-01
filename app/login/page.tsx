import { loginWithPassword } from "./actions";
export const dynamic = "force-dynamic";
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  return <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-zinc-100">
    <section className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-8">
      <h1 className="text-2xl font-semibold">Silvijn Studio</h1>
      <p className="mt-2 text-sm text-zinc-400">Beveiligd intern dashboard. Toegang uitsluitend voor de studio-eigenaar.</p>
      {!configured ? <p role="alert" className="mt-6 text-sm text-amber-400">BLOCKED_EXTERNAL_CONFIGURATION: Supabase-login is nog niet geconfigureerd.</p> : <form action={loginWithPassword} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm" htmlFor="email">Studio e-mailadres</label>
          <input id="email" name="email" type="email" required autoComplete="email" placeholder="silvijn@silvijnstudio.com" className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="block text-sm" htmlFor="password">Wachtwoord</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <button className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">Inloggen</button>
      </form>}
      <a href="https://silvijnstudio.com" className="mt-4 block w-full rounded-lg border border-zinc-700 px-4 py-3 text-center text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">Ga naar website</a>
      {params.error && <p role="alert" className="mt-4 text-sm text-amber-400">{params.error === "rate_limit" ? "Te veel inlogpogingen. Wacht even en probeer het opnieuw." : params.error === "invalid" ? "Onjuist e-mailadres of wachtwoord." : "Geen toegang. Gebruik het geautoriseerde studio-account."}</p>}
    </section>
  </main>;
}
