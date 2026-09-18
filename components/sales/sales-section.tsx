"use client";

import Link from "next/link";
import { listOutreachDrafts } from "@/app/actions/outreach";
import type { OutreachDraft } from "@/lib/outreach/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  analyzeInboundMessageAction,
  createInboundMessageAction,
  listInboundMessagesAction,
  listSalesInteractionsAction,
  markHandledAction,
  markReadyForSilvijnAction,
} from "@/app/actions/sales";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import type { InboundMessage, SalesInteraction } from "@/lib/sales/types";

/**
 * AI Sales-sectie op de lead-detailpagina (Fase 7). De AI is hier een eerste
 * sales-assistent: analyseert inkomende reacties, kwalificeert en draft een
 * antwoord. Alles is CONCEPT — er wordt nooit automatisch verzonden of
 * iets toegezegd; verzenden/prijzen volgen in latere fases.
 */

const intentLabels: Record<string, string> = {
  interested: "Geïnteresseerd",
  question: "Vraag",
  price_request: "Prijsaanvraag",
  demo_request: "Demo-aanvraag",
  call_request: "Belverzoek",
  more_information: "Meer informatie",
  not_interested: "Niet geïnteresseerd",
  objection: "Bezwaar",
  not_now: "Nu niet",
  wrong_contact: "Verkeerd contact",
  opt_out: "Afmelding",
  unclear: "Onduidelijk",
};

const statusMeta: Record<string, { label: string; variant: "warning" | "info" | "success" | "neutral" }> = {
  draft: { label: "Concept — wacht op review", variant: "info" },
  ready_for_silvijn: { label: "READY FOR SILVIJN", variant: "warning" },
  handled: { label: "Afgehandeld", variant: "success" },
  cancelled: { label: "Geannuleerd", variant: "neutral" },
};

const interestLabels: Record<string, string> = {
  none: "geen", low: "laag", medium: "gemiddeld", high: "hoog",
};

const inputClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none";

export function SalesSection({ leadId, leadBusinessName }: { leadId: string; leadBusinessName: string }) {
  const router=useRouter();
  const [confirmed,setConfirmed]=useState(false);
  const [receivedAt,setReceivedAt]=useState("");
  const [outreachOptions,setOutreachOptions]=useState<OutreachDraft[]>([]);
  const [outreachId,setOutreachId]=useState("");
  const [requestId,setRequestId]=useState(()=>crypto.randomUUID());
  const [inbound, setInbound] = useState<InboundMessage[]>([]);
  const [interactions, setInteractions] = useState<SalesInteraction[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ sender: "", subject: "", body: "" });
  const [pending, setPending] = useState(false);

  // Gewone async runner — geen startTransition: React 19 levert een rejection
  // van een async transition-callback af aan de error boundary in plaats van de
  // lokale catch. Zo blijven actiefouten een nette inline melding.
  async function runPending<T>(fn: () => Promise<T>): Promise<void> {
    setPending(true);
    try {
      await fn();
    } finally {
      setPending(false);
    }
  }

  const refresh = useCallback(async () => {
    const [inboundList, interactionList] = await Promise.all([
      listInboundMessagesAction(leadId),
      listSalesInteractionsAction(leadId),
    ]);
    setInbound(inboundList);
    setInteractions(interactionList);
    setLoaded(true);
  }, [leadId]);

  useEffect(() => {
    let active = true;
    Promise.all([listInboundMessagesAction(leadId), listSalesInteractionsAction(leadId), listOutreachDrafts(leadId)])
      .then(([inboundList, interactionList, outreach]) => {
        if (active) {
          setOutreachOptions(outreach.filter(o=>o.status==="sent"));
          setInbound(inboundList);
          setInteractions(interactionList);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setError("Sales-data kon niet worden geladen");
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [leadId]);

  function addInbound() {
    if (!confirmed || !receivedAt || !form.sender.trim()) { setError("Bevestig een werkelijk ontvangen reactie, afzender en ontvangsttijd."); return; }
    if (!form.body.trim()) {
      setError("Berichttekst ontbreekt");
      return;
    }
    setError(null);
    runPending(async () => {
      try {
        await createInboundMessageAction({ leadId, ...form, confirmedReply:true, receivedAt:new Date(receivedAt).toISOString(), requestId, outreachId:outreachId||null });
        setRequestId(crypto.randomUUID()); setConfirmed(false); setReceivedAt(""); setOutreachId(""); router.refresh();
        setForm({ sender: "", subject: "", body: "" });
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Bericht toevoegen mislukt");
      }
    });
  }

  function analyze(inboundMessageId: string) {
    setError(null);
    runPending(async () => {
      try {
        await analyzeInboundMessageAction(leadId, inboundMessageId);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Analyse mislukt");
      }
    });
  }

  function updateStatus(interactionId: string, action: "ready" | "handled") {
    runPending(async () => {
      try {
        await (action === "ready" ? markReadyForSilvijnAction(interactionId) : markHandledAction(interactionId));
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Bijwerken mislukt");
      }
    });
  }

  const latest = interactions[0];

  return (
    <Card>
      <CardHeader
        title="AI Sales"
        subtitle={latest ? `Laatste analyse: ${intentLabels[latest.intent] ?? latest.intent}` : "Nog geen analyses — voeg een inkomende reactie toe"}
      />

      <div className="space-y-5">
        {/* Inkomend bericht toevoegen (mock/dev: handmatig; echte inbox volgt later) */}
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Inkomende reactie registreren <span className="normal-case text-zinc-500">(handmatig vastgelegde echte reactie; Gmail is niet gekoppeld)</span>
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={form.sender}
              onChange={(e) => setForm((f) => ({ ...f, sender: e.target.value }))}
              aria-label="E-mailadres afzender" type="email" placeholder="E-mailadres van de afzender"
              className={inputClass}
            />
            <input
              value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              placeholder="Onderwerp"
              className={inputClass}
            />
          </div>
          <textarea
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            placeholder="Berichttekst van de lead..."
            rows={3}
            className={inputClass}
          />
          <label className="block text-xs text-zinc-300">Werkelijke ontvangsttijd (lokale tijd)<input type="datetime-local" className={inputClass} value={receivedAt} onChange={e=>setReceivedAt(e.target.value)} required/></label>
          <label className="block text-xs text-zinc-300">Beantwoord outreachbericht (optioneel)<select className={inputClass} value={outreachId} onChange={e=>setOutreachId(e.target.value)}><option value="">Niet gekoppeld / zelfstandig ontvangen</option>{outreachOptions.map(o=><option key={o.id} value={o.id}>{o.subject||o.purpose||"Outreach"} ({new Date(o.sentAt??o.createdAt).toLocaleDateString("nl-NL")})</option>)}</select></label>
          <label className="flex items-start gap-2 text-xs text-zinc-300"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Ik leg een daadwerkelijk ontvangen reactie vast, geen voorbeeld of testbericht.</label>
          <button
            type="button"
            onClick={addInbound}
            disabled={pending}
            className="h-9 rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-xs font-semibold text-zinc-200 transition-colors hover:border-zinc-500 disabled:opacity-60"
          >
            Reactie registreren
          </button>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        {/* Inkomende berichten */}
        {!loaded ? (
          <p className="text-sm text-zinc-500">Laden...</p>
        ) : inbound.length === 0 ? (
          <p className="text-sm text-zinc-500">Nog geen inkomende reacties voor {leadBusinessName}.</p>
        ) : (
          <div className="space-y-3">
            {inbound
              .slice()
              .reverse()
              .slice(0, 3)
              .map((message) => {
                const analyzed = interactions.some((i) => i.inboundMessageId === message.id);
                return (
                  <div key={message.id} className="rounded-lg border border-zinc-800 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-zinc-100">
                        {message.sender} <span className="text-zinc-500">· {message.subject || "(geen onderwerp)"}</span>
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-500">
                          {new Date(message.receivedAt).toLocaleDateString("nl-NL")}
                        </span>
                        {analyzed ? (
                          <Badge variant="success">Geanalyseerd</Badge>
                        ) : (
                          <button
                            type="button"
                            onClick={() => analyze(message.id)}
                            disabled={pending || !message.replyConfirmed}
                            className="h-9 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-zinc-50 transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:ring-indigo-500"
                          >
                            Analyze Response
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="mt-2 whitespace-pre-line text-sm text-zinc-300">{message.body}</p>
                    {message.conversationId?<Link className="mt-2 block text-xs text-indigo-300" href={`/conversations?id=${message.conversationId}`}>Volledig gesprek bekijken</Link>:<p className="mt-2 text-xs text-amber-300">Onbevestigd oud bericht. Geen actief gesprek en geen bewijs voor salesstatus.</p>}
                  </div>
                );
              })}
          </div>
        )}

        {/* Laatste analyse */}
        {latest && (
          <div className="space-y-4 rounded-lg border border-indigo-500/30 bg-indigo-950/20 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="warning">AI GENERATED DRAFT</Badge>
              <Badge variant={statusMeta[latest.status]?.variant ?? "neutral"}>
                {statusMeta[latest.status]?.label ?? latest.status}
              </Badge>
              {latest.escalationRequired && (
                <span className="text-xs font-medium text-amber-400">⚠ Escalatie: {latest.escalationReason ?? "menselijke beslissing nodig"}</span>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-500">Intent</p>
                <p className="text-sm text-zinc-100">
                  {intentLabels[latest.intent] ?? latest.intent}
                  {latest.objectionType !== "none" && latest.objectionType !== "unclear" && (
                    <span className="text-zinc-500"> · bezwaar: {latest.objectionType}</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-500">Kwalificatie</p>
                <p className="text-sm text-zinc-100">
                  {latest.qualification.status} · interesse: {interestLabels[latest.qualification.interestLevel]} · confidence {Math.round(latest.qualification.confidence * 100)}%
                </p>
              </div>
            </div>

            {latest.qualification.missingInformation.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-500">Ontbrekende informatie</p>
                <ul className="mt-1 list-inside list-disc text-sm text-zinc-300">
                  {latest.qualification.missingInformation.map((info) => (
                    <li key={info}>{info}</li>
                  ))}
                </ul>
              </div>
            )}

            {latest.questions.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-500">Vervolgvragen (voorgesteld)</p>
                <ul className="mt-1 list-inside list-disc text-sm text-zinc-300">
                  {latest.questions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">Voorgestelde volgende actie</p>
              <p className="text-sm text-zinc-200">{latest.suggestedNextAction}</p>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">Antwoord-concept (nog NIET verzonden)</p>
              <p className="mt-1 whitespace-pre-line rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-300">
                {latest.responseDraft}
              </p>
            </div>

            {latest.qualityIssues.length > 0 && (
              <div className="rounded-lg border border-red-500/40 bg-red-950/40 p-3">
                <p className="text-xs font-semibold text-red-300">Kwaliteitscheck:</p>
                <ul className="mt-1 list-inside list-disc text-xs text-red-300/80">
                  {latest.qualityIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {latest.status === "draft" && (
                <button
                  type="button"
                  onClick={() => updateStatus(latest.id, "ready")}
                  disabled={pending}
                  className="h-9 rounded-lg border border-amber-500/40 bg-amber-950/60 px-3 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-900/60 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:ring-amber-500"
                >
                  Mark Ready for Silvijn
                </button>
              )}
              {latest.status !== "handled" && (
                <button
                  type="button"
                  onClick={() => updateStatus(latest.id, "handled")}
                  disabled={pending}
                  className="h-9 rounded-lg border border-zinc-700 px-3 text-xs font-semibold text-zinc-300 transition-colors hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:ring-indigo-500"
                >
                  Markeer afgehandeld
                </button>
              )}
              <span className="self-center text-xs text-zinc-500">
                Er is géén verzendknop — antwoorden worden nooit automatisch verstuurd (Fase 7).
              </span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
