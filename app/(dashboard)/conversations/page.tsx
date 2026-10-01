import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStudioOwner } from "@/lib/auth/server";
import { getConversationPage } from "@/lib/sales/conversations";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { leadLifecycleMeta } from "@/lib/leads/lifecycle";
import { cleanMessageForDisplay } from "@/lib/sales/message-clean";
import { resolveShowTestData, testLeadIdSet } from "@/lib/leads/test-data";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { MarkConversationRead } from "@/components/conversations/mark-read";
import { z } from "zod";

/**
 * Conversations — echte inbox/conversation-manager.
 *
 * Alleen gesprekken met een bevestigde reactie van een klant/lead
 * (initiële outreach zonder antwoord staat hier niet; zie de
 * attach-trigger in migratie 0012). Per gesprek: bedrijfsnaam,
 * e-mailadres, onderwerp, laatste bericht, tijdstip, status en een
 * ongelezen-indicator. De thread toont inkomende én uitgaande
 * berichten chronologisch als chat (KLANT / SILVIJN STUDIO), zonder
 * dubbele gequoteerde Gmail-historie.
 */

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) + " · " + d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

function formatFull(iso: string): string {
  return new Date(iso).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" });
}

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStudioOwner();
  const params = await searchParams;
  const lead = typeof params.lead === "string" ? params.lead : undefined;
  const id = typeof params.id === "string" ? params.id : undefined;
  if ((lead && !z.uuid().safeParse(lead).success) || (id && !z.uuid().safeParse(id).success)) notFound();
  const page = Math.max(0, parseInt(String(params.page ?? "0"), 10) || 0);
  const messagePage = Math.max(0, parseInt(String(params.messages ?? "0"), 10) || 0);
  const showTestData = resolveShowTestData(params);
  const leads = await getLeadRepository().list();
  // Testdata-scheiding (2026-10-01): gesprekken van mock-/fixture-leads zijn
  // verborgen in de lijst (?test=1 toont expliciet); deeplinks blijven werken.
  const excludeLeadIds = showTestData ? [] : [...testLeadIdSet(leads)];
  const result = await getConversationPage({ leadId: lead, conversationId: id, page, messagePage, excludeLeadIds });
  if (id && !result.active) notFound();
  const leadMap = new Map(leads.map((l) => [l.id, l]));
  const activeLead = result.active ? leadMap.get(result.active.lead_id) : undefined;
  const activeItem = result.listItems.find((c) => c.id === result.active?.id) ?? null;

  function href(values: { id?: string; page?: number; messages?: number }) {
    const q = new URLSearchParams();
    if (lead) q.set("lead", lead);
    if (values.id) q.set("id", values.id);
    q.set("page", String(values.page ?? page));
    q.set("messages", String(values.messages ?? 0));
    return `/conversations?${q.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">Gesprekken</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Alleen gesprekken met een reactie van de klant. Outreach zonder antwoord staat hier niet.
        </p>
      </div>

      {result.count === 0 && !result.active ? (
        <Card className="p-8">
          <p className="font-medium text-zinc-200">Nog geen gesprekken</p>
          <p className="mt-2 text-sm text-zinc-400">Zodra een klant voor het eerst reageert op jouw outreach verschijnt het gesprek hier automatisch (Gmail-ingest koppelt elke 15 minuten).</p>
          {lead && <Link className="mt-4 block text-sm text-indigo-300" href={`/leads/${lead}`}>Naar lead en ontvangen reacties</Link>}
        </Card>
      ) : (
        <div className="grid min-w-0 gap-6 lg:grid-cols-3">
          {/* Inbox-lijst */}
          <Card className={`min-w-0 ${result.active ? "hidden lg:block" : ""}`}>
            <CardHeader title="Gesprekken" subtitle={`${result.count} gesprek(ken)`} />
            <div className="space-y-2">
              {result.listItems.map((c) => {
                const l = leadMap.get(c.lead_id);
                return (
                  <Link
                    key={c.id}
                    href={href({ id: c.id, messages: 0 })}
                    aria-current={result.active?.id === c.id ? "page" : undefined}
                    className={`block rounded-lg border p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      result.active?.id === c.id ? "border-indigo-500 bg-indigo-500/10" : "border-zinc-800 hover:bg-zinc-800/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className={`break-words text-sm ${c.unread ? "font-semibold text-zinc-50" : "font-medium text-zinc-100"}`}>{l?.businessName ?? "Lead"}</p>
                      {c.unread && <span className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-indigo-500" aria-label="Nieuw bericht" />}
                    </div>
                    <p className="mt-0.5 break-all text-xs text-zinc-400">{c.email || c.contact_id}</p>
                    {c.subject && <p className={`mt-1 truncate text-xs ${c.unread ? "text-zinc-300" : "text-zinc-500"}`}>{c.subject}</p>}
                    <p className="mt-1 line-clamp-2 text-xs text-zinc-400">{c.lastDirection === "inbound" ? "" : "Jij: "}{c.lastPreview}</p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className="text-xs text-zinc-500">{formatDateTime(c.lastMessageAt)}</p>
                      {l && <Badge variant={leadLifecycleMeta[l.leadStatus].variant}>{leadLifecycleMeta[l.leadStatus].label}</Badge>}
                    </div>
                  </Link>
                );
              })}
            </div>
            <div className="mt-4 flex gap-4 text-sm text-indigo-300">
              {page > 0 && <Link href={href({ page: page - 1 })}>Vorige</Link>}
              {(page + 1) * 30 < result.count && <Link href={href({ page: page + 1 })}>Volgende</Link>}
            </div>
          </Card>

          {/* Thread */}
          {result.active && activeItem && (
            <Card className="min-w-0 lg:col-span-2">
              {activeItem.unread && <MarkConversationRead conversationId={result.active.id} unread />}
              <Link className="text-xs text-indigo-300 lg:hidden" href={href({ id: undefined, messages: 0 })}>← Alle gesprekken</Link>
              <CardHeader title={activeLead?.businessName ?? "Gesprek"} subtitle={`${activeItem.email || result.contact || result.active.channel}${activeItem.subject ? ` · ${activeItem.subject}` : ""}`} />
              <Link className="text-xs text-indigo-300" href={`/leads/${result.active.lead_id}`}>Lead, lifecycle en reactie registreren</Link>

              <div className="mt-5 space-y-3">
                {result.messages.map((m) => {
                  const inbound = m.direction === "inbound";
                  return (
                    <article key={m.id} className={`flex flex-col ${inbound ? "items-start" : "items-end"}`}>
                      <p className={`mb-1 text-xs font-semibold ${inbound ? "text-zinc-300" : "text-indigo-400"}`}>
                        {inbound ? "KLANT" : "SILVIJN STUDIO"} <span className="ml-2 font-normal text-zinc-500">{formatFull(m.occurred_at)}</span>
                      </p>
                      <div
                        className={`max-w-[92%] rounded-xl border p-4 sm:max-w-[80%] ${
                          inbound ? "border-zinc-700 bg-zinc-800/50" : "border-indigo-500/30 bg-indigo-500/5"
                        }`}
                      >
                        {m.subject && <h2 className="mb-1 break-words text-xs font-medium text-zinc-400">{m.subject}</h2>}
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-100">{cleanMessageForDisplay(m.body)}</p>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="mt-5 flex flex-wrap gap-4 text-sm text-indigo-300">
                {messagePage > 0 && <Link href={href({ id: result.active.id, messages: messagePage - 1 })}>Eerdere berichten</Link>}
                {(messagePage + 1) * 50 < result.messageCount && <Link href={href({ id: result.active.id, messages: messagePage + 1 })}>Latere berichten</Link>}
              </div>
              <p className="mt-4 text-xs text-zinc-500">Geen automatische verzending of AI-antwoorden vanuit deze pagina; concepten staan bij AI Sales.</p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
