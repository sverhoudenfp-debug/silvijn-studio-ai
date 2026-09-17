"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { disconnectGmail, startGmailConnect, syncGmailInbox } from "@/app/actions/gmail";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";

/**
 * Gmail-verbindingskaart (Settings) — OAuth 2.0, owner-only. Verbinden,
 * synchroniseren en verbreken zijn altijd expliciete menselijke acties;
 * de verbindingstuimel bevat nooit tokens of secrets.
 */

interface FlashState {
  error: string | null;
  connected: string | null;
}

export function GmailSettingsCard({
  gmail,
  flash,
}: {
  gmail: { configured: boolean; connected: boolean; accountKey: string | null; lastIngestAt: string | null };
  flash: FlashState;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  function run(action: () => Promise<unknown>) {
    startTransition(async () => {
      try {
        const result = await action();
        if (result && typeof result === "object" && "ingested" in result) {
          const r = result as { scanned: number; ingested: number; unmatched: number };
          setMessage(`Synchronisatie klaar: ${r.ingested} nieuwe reactie(s) opgeslagen van ${r.scanned} gescand (${r.unmatched} geen match).`);
        }
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Actie mislukt");
      }
    });
  }

  return (
    <Card className="border-zinc-800">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-zinc-100">Gmail (OAuth 2.0)</p>
            {gmail.connected ? (
              <Badge variant="success">Verbonden</Badge>
            ) : gmail.configured ? (
              <Badge variant="warning">Niet verbonden</Badge>
            ) : (
              <Badge variant="danger">Niet geconfigureerd</Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Studio-account: {gmail.accountKey ?? "silvijn@silvijnstudio.com"} — verzenden en inkomende reacties via de Gmail-API.
            Nooit wachtwoorden; alleen geautoriseerde OAuth-tokens (versleuteld opgeslagen).
          </p>
          {gmail.lastIngestAt && (
            <p className="mt-1 text-xs text-zinc-500">Laatste synchronisatie: {new Date(gmail.lastIngestAt).toLocaleString("nl-NL")}</p>
          )}
          {!gmail.configured && (
            <p className="mt-1 text-xs text-amber-400">
              BLOCKED_EXTERNAL_CONFIGURATION: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET en GMAIL_TOKEN_ENCRYPTION_KEY ontbreken (Vercel Environment Variables).
            </p>
          )}
          {flash.error && <p role="alert" className="mt-1 text-xs text-amber-400">Gmail-actie mislukt ({flash.error}). Probeer het opnieuw.</p>}
          {flash.connected && !flash.error && <p role="status" className="mt-1 text-xs text-emerald-400">Gmail-account verbonden.</p>}
          {message && <p role="status" className="mt-1 text-xs text-zinc-300">{message}</p>}
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          {!gmail.connected ? (
            <button
              className={buttonClasses("primary")}
              disabled={pending || !gmail.configured}
              onClick={() => run(startGmailConnect)}
            >
              {pending ? "Bezig…" : "Verbind met Google"}
            </button>
          ) : (
            <>
              <button className={buttonClasses("primary")} disabled={pending} onClick={() => run(syncGmailInbox)}>
                {pending ? "Bezig…" : "Inbox synchroniseren"}
              </button>
              <button className={buttonClasses("primary")} disabled={pending} onClick={() => run(disconnectGmail)}>
                Verbinding verbreken
              </button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
