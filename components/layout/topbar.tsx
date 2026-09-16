"use client";

import { usePathname } from "next/navigation";

const titles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/leads": "Leads",
  "/lead-discovery": "Lead Discovery",
  "/outreach": "AI Outreach",
  "/sales": "AI Sales",
  "/conversations": "Conversations",
  "/demo-websites": "Demo Websites",
  "/projects": "Projects",
  "/generated-websites": "Websites",
  "/analytics": "Analytics",
  "/automations": "Automations",
  "/automation": "Automation",
  "/settings": "Settings",
};

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const pathname = usePathname();
  const title =
    titles[pathname] ??
    (pathname.startsWith("/leads/") ? "Leads"
      : pathname.startsWith("/projects/") ? "Projects"
      : pathname.startsWith("/automations/") ? "Automations"
      : pathname.startsWith("/automation-runs/") ? "Automations"
      : pathname.startsWith("/generated-websites/") ? "Websites"
      : pathname.startsWith("/demo-websites/") ? "Demo Websites"
      : "Silvijn Studio AI");

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/80 px-4 backdrop-blur sm:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Menu openen"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 lg:hidden"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
        <p aria-hidden="true" className="text-sm font-semibold text-zinc-100">{title}</p>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <input
          type="search"
          aria-label="Zoeken"
          placeholder="Zoek leads, projecten..."
          className="hidden h-9 w-52 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none sm:block"
        />
        <button
          type="button"
          aria-label="Notificaties"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-indigo-400" />
        </button>
        <button
          type="button"
          className="hidden h-9 items-center rounded-lg border border-red-500/30 bg-red-950/30 px-3 text-xs font-medium text-red-300 transition-colors hover:bg-red-950/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 sm:inline-flex"
        >
          Pause automations
        </button>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-violet-600 text-xs font-semibold text-white">
          S
        </span>
      </div>
    </header>
  );
}
