"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setReplyHandlingModeAction } from "@/app/actions/settings";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";

type Mode = "off" | "review" | "auto";

export function ReplyHandlingCard({ mode, options }: { mode: Mode; options: Record<Mode, { label: string; description: string }> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(next: Mode) {
    if (next === mode || busy) return;
    setBusy(true);
    setError(null);
    const result = await setReplyHandlingModeAction(next);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <Card>
      <CardHeader
        title="Autonome reply-afhandeling"
        subtitle="Wat de Gmail-ingest (elke 15 minuten) met nieuw gekoppelde prospect-reacties mag doen"
      />
      <div className="space-y-2">
        {(Object.keys(options) as Mode[]).map((key) => {
          const active = key === mode;
          return (
            <button
              key={key}
              type="button"
              disabled={busy}
              onClick={() => choose(key)}
              aria-pressed={active}
              className={`flex w-full items-start justify-between gap-3 rounded-md border px-3 py-2.5 text-left transition-colors ${
                active ? "border-zinc-500 bg-zinc-800/60" : "border-zinc-800 hover:border-zinc-700"
              } disabled:opacity-60`}
            >
              <div>
                <p className="text-sm font-medium text-zinc-100">{options[key].label}</p>
                <p className="mt-0.5 text-xs text-zinc-400">{options[key].description}</p>
              </div>
              {active && <Badge variant="success">Actief</Badge>}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        Ongeacht de modus: geen prijsonderhandeling of -goedkeuring, geen betaallinks of betaalbevestiging, geen levering of Shopify-overdracht door AI. Elke wijziging wordt geauditeerd.
      </p>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </Card>
  );
}
