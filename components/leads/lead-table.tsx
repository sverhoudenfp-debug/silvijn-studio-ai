"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  demoStatusMeta,
  leadStatusMeta,
  outreachStatusMeta,
  websiteStatusMeta,
} from "@/lib/mock-data";
import type { Lead } from "@/lib/types";
import { scoreCategory, scoreVariant } from "@/lib/utils";

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
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-5 py-3 font-medium">Business</th>
              <th className="px-3 py-3 font-medium">Industry</th>
              <th className="px-3 py-3 font-medium">Location</th>
              <th className="px-3 py-3 font-medium">Website</th>
              <th className="px-3 py-3 font-medium">Lead Score</th>
              <th className="px-3 py-3 font-medium">Lead Status</th>
              <th className="px-3 py-3 font-medium">Outreach</th>
              <th className="px-3 py-3 font-medium">Demo</th>
              <th className="px-3 py-3 font-medium">Created</th>
              <th className="px-3 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30">
                <td className="px-5 py-3">
                  <Link href={`/leads/${lead.id}`} className="font-medium text-zinc-100 hover:text-indigo-300">
                    {lead.businessName}
                  </Link>
                </td>
                <td className="px-3 py-3 text-zinc-400">{lead.industry}</td>
                <td className="px-3 py-3 text-zinc-400">{lead.city}</td>
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
                  <Badge variant={outreachStatusMeta[lead.outreachStatus].variant}>
                    {outreachStatusMeta[lead.outreachStatus].label}
                  </Badge>
                </td>
                <td className="px-3 py-3">
                  <Badge variant={demoStatusMeta[lead.demoStatus].variant}>
                    {demoStatusMeta[lead.demoStatus].label}
                  </Badge>
                </td>
                <td className="px-3 py-3 text-zinc-500">{lead.createdAt.slice(0, 10)}</td>
                <td className="px-3 py-3">
                  <Link href={`/leads/${lead.id}`} className="text-xs font-medium text-indigo-400 hover:text-indigo-300">
                    View →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: card/list */}
      <div className="space-y-3 md:hidden">
        {leads.map((lead) => (
          <Link
            key={lead.id}
            href={`/leads/${lead.id}`}
            className="block rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 transition-colors hover:border-zinc-700"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-100">{lead.businessName}</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {lead.industry} · {lead.city}
                </p>
              </div>
              <Badge variant={scoreVariant(lead.leadScore)}>{lead.leadScore}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge variant={leadStatusMeta[lead.leadStatus].variant}>
                {leadStatusMeta[lead.leadStatus].label}
              </Badge>
              <Badge variant={websiteStatusMeta[lead.websiteStatus].variant}>
                {websiteStatusMeta[lead.websiteStatus].label}
              </Badge>
              <Badge variant={outreachStatusMeta[lead.outreachStatus].variant}>
                {outreachStatusMeta[lead.outreachStatus].label}
              </Badge>
              <Badge variant={demoStatusMeta[lead.demoStatus].variant}>
                {demoStatusMeta[lead.demoStatus].label}
              </Badge>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
