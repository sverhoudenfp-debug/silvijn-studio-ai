"use client";

import { usePathname } from "next/navigation";

const titles: Record<string, string> = {
  "/": "Dashboard",
  "/leads": "Leads",
  "/outreach": "AI Outreach",
  "/conversations": "Conversations",
  "/demos": "Demo Websites",
  "/projects": "Projects",
  "/websites": "Websites",
  "/analytics": "Analytics",
  "/automation": "Automation",
  "/settings": "Settings",
};

export function Topbar() {
  const pathname = usePathname();
  const title = titles[pathname] ?? "Silvijn Studio";

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-zinc-800 bg-zinc-950/80 px-6 backdrop-blur">
      <h1 className="text-sm font-semibold text-zinc-100">{title}</h1>
      <div className="flex items-center gap-3">
        <input
          type="search"
          placeholder="Zoek leads, projecten..."
          className="hidden h-8 w-56 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none sm:block"
        />
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-red-900 hover:text-red-300"
        >
          Pause automations
        </button>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-violet-600 text-xs font-semibold text-white">
          S
        </span>
      </div>
    </header>
  );
}
