import type { DemoWebsite, Lead } from "@/lib/types";

/**
 * Statuspagina voor demo's die nog niet bekenbaar zijn:
 * GENERATING → "wordt voorbereid", FAILED → foutstatus.
 */
export function DemoStatusPage({ demo }: { demo: DemoWebsite; lead?: Lead }) {
  const generating = demo.status === "generating";

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800/70">
          {generating ? (
            <span className="h-3 w-3 animate-ping rounded-full bg-indigo-500" />
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5 text-red-400"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
          )}
        </div>
        <h1 className="mt-4 text-lg font-semibold text-zinc-50">
          {generating
            ? "Demo wordt voorbereid"
            : "Demo-generatie is mislukt"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          {generating
            ? `De demo-website voor ${demo.businessName} is in opbouw. Straks is hij hier te bekijken.`
            : `Het aanmaken van de demo voor ${demo.businessName} is niet gelukt. De demo kan op een later moment opnieuw worden gegenereerd.`}
        </p>

      </div>
    </div>
  );
}
