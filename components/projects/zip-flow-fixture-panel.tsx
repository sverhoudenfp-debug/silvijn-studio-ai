"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createZipFlowFixtureAction,
  removeZipFlowFixtureAction,
} from "@/app/actions/project-zip-fixture";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";
import type { ZipFlowFixtureSummary } from "@/lib/testing/project-zip-fixture";

/**
 * Zip-flow fixture-paneel (intern, owner-only) — de veilige entree naar de
 * interne Project → Requirements → Design Plan → Theme ZIP flow-test.
 *
 * De fixture is expliciet gemarkeerde, fictieve testdata; de
 * lifecycle-guards (o.a. CONFIRMED_PROSPECT_REPLY_REQUIRED) blijven
 * onaangeroerd omdat de fixture-lead via de wettige new→qualified-transition
 * start en NOOIT een prospect-reactie aanmaakt.
 */

export function ZipFlowFixturePanel({ fixtures }: { fixtures: ZipFlowFixtureSummary[] }) {
  const [pending, setPending] = useState<"create" | "remove" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function createFixture() {
    setError(null);
    setMessage(null);
    setPending("create");
    try {
      const result = await createZipFlowFixtureAction();
      if ("error" in result) {
        setError(result.error);
      } else {
        setMessage(
          "Fixture klaar. Open het project en loop de bestaande flow: financiering (prijs, betaalplan, betaling), Design Plan en websitegeneratie (Theme ZIP)."
        );
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fixture aanmaken mislukt");
    } finally {
      setPending(null);
    }
  }

  async function removeFixture(leadId: string) {
    setError(null);
    setMessage(null);
    setPending("remove");
    try {
      const result = await removeZipFlowFixtureAction(leadId);
      if ("error" in result) {
        setError(result.error);
      } else {
        setMessage("Fixture volledig opgeruimd (inclusief ZIP-artefacten).");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fixture verwijderen mislukt");
    } finally {
      setPending(null);
    }
  }

  return (
    <Card className="border-dashed border-zinc-800">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-zinc-100">Testfixture — Project → ZIP flow (intern)</p>
            <Badge variant="neutral">Fictief</Badge>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            Veilig startpunt voor de interne flow: een dubbel gemarkeerde, fictieve lead (via de wettige
            new→qualified-transition, zonder prospect-reactie) met een project en complete requirements.
            De lifecycle-guards blijven onaangeroerd; prijs-/betaal-goedkeuring blijf je zelf doen via
            de bestaande finance-UI. Opruimen verwijdert de volledige fixture-voetafdruk transactioneel.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {fixtures.length === 0 ? (
            <button type="button" className={buttonClasses("primary")} onClick={createFixture} disabled={pending !== null}>
              {pending === "create" ? "Aanmaken..." : "Fixture aanmaken"}
            </button>
          ) : null}
        </div>
      </div>

      {fixtures.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {fixtures.map((fixture) => (
            <li
              key={fixture.leadId}
              className="flex flex-col gap-2 rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-zinc-200">{fixture.businessName}</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Lead-status: {fixture.leadStatus}
                  {fixture.projectId ? (
                    <>
                      {" · "}
                      <Link href={`/projects/${fixture.projectId}`} className="text-indigo-400 hover:text-indigo-300">
                        Project openen
                      </Link>
                      {fixture.requirementsComplete ? " · requirements compleet" : " · requirements nog niet compleet"}
                    </>
                  ) : (
                    " · geen project (niet normaal — maak opnieuw aan na opruimen)"
                  )}
                </p>
              </div>
              <button
                type="button"
                className={buttonClasses("destructive", "shrink-0")}
                onClick={() => removeFixture(fixture.leadId)}
                disabled={pending !== null}
              >
                {pending === "remove" ? "Opruimen..." : "Fixture opruimen"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {message ? <p className="mt-3 text-xs text-emerald-400">{message}</p> : null}
      {error ? <p className="mt-3 text-xs text-red-400">{error}</p> : null}
    </Card>
  );
}
