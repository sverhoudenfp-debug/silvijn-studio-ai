"use client";

import { useState } from "react";

/** Publieke questionnaire-URL kopiëren (zelfde UX als de demo CopyUrlButton). */
export function CopyableUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard niet beschikbaar — niets doen */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="max-w-full truncate text-xs text-indigo-300 hover:text-indigo-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      title={url}
    >
      {copied ? "Gekopieerd!" : url}
    </button>
  );
}
