"use client";

import { useState } from "react";
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
  authorized?: string | null;
  required?: string | null;
}

export function GmailSettingsCard({
  gmail,
  flash,
}: {
  gmail: {
    configured: boolean;
    connected: boolean;
    accountKey: string | null;
    lastIngestAt: string | null;
    requiredAccountKey: string;
    signatureScope: boolean;
  };
  flash: FlashState;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  async function run(action: () => Promise<unknown>) {
    setMessage(null);
    setPending(true);
    try {
      const result = await action();
      if (result && typeof result === "object" && "ingested" in result) {
        const r = result as { scanned: number; ingested: number; unmatched: number };
        setMessage(`Synchronisatie klaar: ${r.ingested} nieuwe reactie(s) opgeslagen van ${r.scanned} gescand (${r.unmatched} geen match).`);
      }
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Actie mislukt");
    } finally {
      setPending(false);
    }
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
            Outreach-afzender: <span className="text-zinc-300">{gmail.requiredAccountKey}</span>. Verzenden en inkomende reacties lopen via het
            gekoppelde Gmail-account{gmail.accountKey ? ` (${gmail.accountKey})` : ""}; de Gmail-API bepaalt de afzender, nooit een code-instelling.
            Nooit wachtwoorden; alleen geautoriseerde OAuth-tokens (versleuteld opgeslagen).
          </p>
          {!gmail.connected && gmail.configured && (
            <p className="mt-1 text-xs text-amber-400">
              Koppel het Google-account {gmail.requiredAccountKey} zelf (log in Google in met dát account, niet met een ander adres). Een ander
              account wordt geweigerd. Na koppelen wordt de bestaande Gmail-handtekening van dit account automatisch één keer onder elke mail gezet.
            </p>
          )}
          {gmail.connected && !gmail.signatureScope && (
            <p className="mt-1 text-xs text-amber-400">
              Deze koppeling mist de instellingen-scope: de Gmail-handtekening kan niet gelezen worden en wordt dus niet toegevoegd. Verbreek de
              verbinding en koppel opnieuw om de handtekening mee te sturen.
            </p>
          )}
          {gmail.lastIngestAt && (
            <p className="mt-1 text-xs text-zinc-500">Laatste synchronisatie: {new Date(gmail.lastIngestAt).toLocaleString("nl-NL")}</p>
          )}
          {!gmail.configured && (
            <p className="mt-1 text-xs text-amber-400">
              BLOCKED_EXTERNAL_CONFIGURATION: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET en GMAIL_TOKEN_ENCRYPTION_KEY ontbreken (Vercel Environment Variables).
            </p>
          )}
          {flash.error === "wrong_account" ? (
            <p role="alert" className="mt-1 text-xs text-amber-400">
              Verkeerd Google-account: je autoriseerde {flash.authorized ?? "een ander adres"}, maar de outreach-afzender moet{" "}
              {flash.required ?? gmail.requiredAccountKey} zijn. Er is niets opgeslagen. Log bij Google in met {flash.required ?? gmail.requiredAccountKey}{" "}
              (bestaat dat adres alleen als alias of groep, maak er dan eerst een eigen Google Workspace-gebruiker van) en probeer opnieuw.
            </p>
          ) : (
            flash.error && <p role="alert" className="mt-1 text-xs text-amber-400">Gmail-actie mislukt ({flash.error}). Probeer het opnieuw.</p>
          )}
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
