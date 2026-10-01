"use client";

import { useState } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function DashboardShell({
  children,
  aiMode,
  supabaseConnected,
}: {
  children: React.ReactNode;
  aiMode: "live" | "mock" | "configfout";
  supabaseConnected: boolean;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} aiMode={aiMode} supabaseConnected={supabaseConnected} />
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <Topbar onMenuClick={() => setMobileOpen(true)} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
