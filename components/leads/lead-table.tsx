"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  demoStatusMeta,
  leadStatusMeta,
  websiteStatusMeta,
} from "@/lib/mock-data";
import type { Lead } from "@/lib/types";
import { needsManualContact } from "@/lib/outreach/contactability";
import { primaryAction } from "@/lib/leads/primary-action";
import { scoreCategory, scoreVariant } from "@/lib/utils";

/**
 * Leadtabel (2026-10-01) — de zeven beslissingsvelden direct zichtbaar:
 * bedrijf, contact, website-status, score, status, contactability en de
 * belangrijkste actie. Overige details (branche, locatie, datum) staan in
 * de detailweergave.
 */

const actionToneClass: Record<"warning" | "accent" | "neutral", string> = {
  warning: "text-amber-300",
  accent: "text-indigo-300",
  neutral: "text-zinc-400",
};

function ContactCell({ lead }: { lead: Lead }) {
  return (
    <div className="space-y-0.5 text-xs">
      {lead.email ? (
        <p className="max-w-[180px] truncate text-zinc-300" title={lead.email}>{lead.email}</p>
      ) : (
        <p className="text-zinc-600">geen e-mail</p>
      )}
      {lead.phone ? (
        <p className="text-zinc-500">{lead.phone}</p>
      ) : null}
      {needsManualContact(lead) ? (
        <span title="Geen e-mailadres bekend: outreach slaat deze lead over">
          <Badge variant="warning">Handmatig contact</Badge>
        </span>
      ) : null}
    </div>
  );
}

export function LeadTable({ leads }: { leads: Lead[] }) {
  if (leads.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-10 text-center">
        <p className="text-sm font-medium text-zinc-200">Geen leads gevonden</p>
        <p className="mt-1 text-xs text-zinc-500">Pas je filters of zoekopdracht aan.</p>
      </div>
    );
  }

  return (
    <>
      {/* Desktop/tablet: tabel */}
      <div className="hidden overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/60 md:block">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-5 py-3 font-medium">Bedrijf</th>
              <th className="px-3 py-3 font-medium">Contact</th>
              <th className="px-3 py-3 font-medium">Website</th>
              <th className="px-3 py-3 font-medium">Score</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium">Belangrijkste actie</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => {
              const action = primaryAction(lead);
              return (
                <tr key={lead.id} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30">
                  <td className="px-5 py-3">
                    <Link href={`/leads/${lead.id}`} className="font-medium text-zinc-100 hover:text-indigo-300">
                      {lead.businessName}
                    </Link>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {lead.industry} · {lead.city}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <ContactCell lead={lead} />
                  </td>
                  <td className="px-3 py-3">
                    <Badge variant={websiteStatusMeta[lead.websiteStatus].variant}>
                      {websiteStatusMeta[lead.websiteStatus].label}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">
                    <span title={scoreCategory(lead.leadScore)}>
                      <Badge variant={scoreVariant(lead.leadScore)}>
                        {lead.leadScore} · {scoreCategory(lead.leadScore)}
                      </Badge>
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <Badge variant={leadStatusMeta[lead.leadStatus].variant}>
                      {leadStatusMeta[lead.leadStatus].label}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">
                    <Link
                      href={`/leads/${lead.id}`}
                      className={`text-xs font-medium hover:underline ${actionToneClass[action.tone]}`}
                    >
                      {action.label} →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile: compacte kaarten met dezelfde beslissingsvelden */}
      <div className="space-y-3 md:hidden">
        {leads.map((lead) => {
          const action = primaryAction(lead);
          return (
            <Link
              key={lead.id}
              href={`/leads/${lead.id}`}
              className="block rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 transition-colors hover:border-zinc-700"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-100">{lead.businessName}</p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    {lead.email ?? lead.phone ?? "geen contactgegevens"}
                  </p>
                </div>
                <Badge variant={scoreVariant(lead.leadScore)}>{lead.leadScore}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Badge variant={leadStatusMeta[lead.leadStatus].variant}>
                  {leadStatusMeta[lead.leadStatus].label}
                </Badge>
                <Badge variant={websiteStatusMeta[lead.websiteStatus].variant}>
                  {websiteStatusMeta[lead.websiteStatus].label}
                </Badge>
                {lead.demoStatus === "ready" ? (
                  <Badge variant={demoStatusMeta.ready.variant}>Demo</Badge>
                ) : null}
              </div>
              <p className={`mt-2.5 text-xs font-medium ${actionToneClass[action.tone]}`}>{action.label} →</p>
            </Link>
          );
        })}
      </div>
    </>
  );
}
