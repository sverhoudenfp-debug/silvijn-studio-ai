import Link from "next/link";
import type { DemoWebsite, Lead } from "@/lib/types";

/**
 * Statuspagina voor demo's die nog niet bekenbaar zijn:
 * GENERATING → "wordt voorbereid", FAILED → foutstatus.
 */
export function DemoStatusPage({ demo, lead }: { demo: DemoWebsite; lead?: Lead }) {
  const generating = demo.status === "generating";

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100">
          {generating ? (
            <span className="h-3 w-3 animate-ping rounded-full bg-indigo-500" />
          ) : (
            <span className="text-xl">⚠</span>
          )}
        </div>
        <h1 className="mt-4 text-lg font-semibold text-zinc-900">
          {generating
            ? "Demo wordt voorbereid"
            : "Demo-generatie is mislukt"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-500">
          {generating
            ? `De demo-website voor ${demo.businessName} is in opbouw. Straks is hij hier te bekijken.`
            : `Het aanmaken van de demo voor ${demo.businessName} is niet gelukt. De demo kan op een later moment opnieuw worden gegenereerd.`}
        </p>
        {lead ? (
          <Link
            href={`/demo-websites/${demo.id}`}
            className="mt-6 inline-block rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-zinc-700"
          >
            Bekijk demo-details
          </Link>
        ) : null}
      </div>
    </div>
  );
}
