"use client";

import { useState, useTransition } from "react";
import {
  cancelAutomationAction,
  pauseAutomationAction,
  resumeAutomationAction,
  resumeAutomationRunAction,
  runAutomationAction,
} from "@/app/actions/automations";

/**
 * Manual controls (Fase 11): run now / pause / resume / cancel.
 * GEEN approve-knop — websitegoedkeuring is een aparte menselijke actie
 * in het QC-rapport (Fase 10) en wordt bewust NIET gecombineerd met
 * automation-hervatting.
 */

export function AutomationControls({
  automationId,
  status,
  enabled,
}: {
  automationId: string;
  status: string;
  enabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function withAction(action: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Actie mislukt");
      }
    });
  }

  const active = status === "active" && enabled;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {active && (
        <button
          type="button"
          onClick={() => withAction(() => runAutomationAction(automationId))}
          disabled={pending}
          className="h-9 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-zinc-50 transition-colors hover:bg-indigo-500 disabled:opacity-60"
        >
          {pending ? "Draait..." : "Run now"}
        </button>
      )}
      {active && (
        <button
          type="button"
          onClick={() => withAction(() => pauseAutomationAction(automationId))}
          disabled={pending}
          className="h-9 rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-xs font-semibold text-zinc-300 transition-colors hover:border-zinc-500 disabled:opacity-60"
        >
          Pause
        </button>
      )}
      {status === "paused" && (
        <button
          type="button"
          onClick={() => withAction(() => resumeAutomationAction(automationId))}
          disabled={pending}
          className="h-9 rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-xs font-semibold text-zinc-300 transition-colors hover:border-zinc-500 disabled:opacity-60"
        >
          Resume
        </button>
      )}
      {status !== "disabled" && (
        <button
          type="button"
          onClick={() => withAction(() => cancelAutomationAction(automationId))}
          disabled={pending}
          className="h-9 rounded-lg border border-red-500/30 bg-red-950/30 px-4 text-xs font-semibold text-red-300 transition-colors hover:bg-red-950/50 disabled:opacity-60"
        >
          Cancel
        </button>
      )}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}

export function RunResumeControl({ runId, status }: { runId: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (status !== "paused") return null;

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() =>
          startTransition(async () => {
            setError(null);
            try {
              await resumeAutomationRunAction(runId);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Hervatten mislukt");
            }
          })
        }
        disabled={pending}
        className="h-9 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-4 text-xs font-semibold text-indigo-300 transition-colors hover:bg-indigo-500/20 disabled:opacity-60"
      >
        {pending ? "Hervatten..." : "Hervat na human gate"}
      </button>
      <p className="max-w-md text-xs text-zinc-500">
        Hervat alléén na het vervullen van de human gate (bijv. websitegoedkeuring via het QC-rapport). De
        gate-voorwaarde wordt deterministisch her-gecontroleerd.
      </p>
      {error && <span className="block max-w-md text-xs text-red-400">{error}</span>}
    </div>
  );
}
