"use client";

import { signOut } from "@/app/login/actions";
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
        <form action={signOut}><button className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 focus-visible:ring-2 focus-visible:ring-indigo-500">Uitloggen</button></form>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-violet-600 text-xs font-semibold text-white">
          S
        </span>
      </div>
    </header>
  );
}
