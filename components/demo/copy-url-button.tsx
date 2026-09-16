"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export function CopyUrlButton({
  slug,
  className,
}: {
  slug: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/demo/${slug}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard niet beschikbaar (bijv. geen HTTPS/permissions) — niets doen.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        "inline-flex h-9 items-center rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:ring-indigo-500",
        copied ? "border-emerald-700 text-emerald-300" : "text-zinc-300 hover:border-zinc-600 hover:text-zinc-100",
        className
      )}
    >
      {copied ? "Gekopieerd ✓" : "Copy URL"}
    </button>
  );
}
