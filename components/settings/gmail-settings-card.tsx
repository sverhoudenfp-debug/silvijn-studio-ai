"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { disconnectGmail, recheckGmailSendAs, startGmailConnect, syncGmailInbox } from "@/app/actions/gmail";
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
  sendAsStatus?: string | null;
}

const SEND_AS_LABEL: Record<string, string> = {
  verified: "Send-as alias geverifieerd",
  pending: "Send-as alias nog niet geverifieerd",
  not_listed: "Send-as alias ontbreekt",
  unknown: "Send-as alias niet controleerbaar",
};

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
    sendAsEmail: string;
    sendAs: { status: "verified" | "pending" | "not_listed" | "unknown"; displayName: string | null; reason: string | null; checkedAt: string } | null;
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
      } else if (result && typeof result === "object" && "status" in result) {
        const r = result as { ok: boolean; status: string; reason?: string };
        setMessage(r.ok ? `Gmail bevestigt: ${SEND_AS_LABEL[r.status]}.` : `${SEND_AS_LABEL[r.status] ?? r.status}: ${r.reason ?? ""}`);
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
            Eén Google OAuth-koppeling met het primaire Workspace-account; outreach gaat uit met het &quot;Verzenden als&quot;-alias van dat account
            (Gmail API settings.sendAs). Antwoorden komen in dezelfde Gmail-inbox en thread terug. Geen aparte gebruiker of tweede login nodig;
            nooit wachtwoorden, alleen geautoriseerde OAuth-tokens (versleuteld opgeslagen).
          </p>
          <dl className="mt-2 grid gap-1 text-xs">
            <div className="flex gap-2">
              <dt className="w-52 shrink-0 text-zinc-500">Verbonden Gmail-account:</dt>
              <dd className="text-zinc-200">{gmail.connected ? gmail.accountKey : `— (vereist: ${gmail.requiredAccountKey})`}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-52 shrink-0 text-zinc-500">Outreach verzenden als:</dt>
              <dd className="text-zinc-200">
                {gmail.sendAsEmail}
                {gmail.sendAs?.status === "verified" && gmail.sendAs.displayName ? ` (weergavenaam: ${gmail.sendAs.displayName})` : ""}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-52 shrink-0 text-zinc-500">Status:</dt>
              <dd data-testid="send-as-status" className={gmail.sendAs?.status === "verified" ? "text-emerald-400" : "text-amber-400"}>
                {!gmail.connected
                  ? "Niet verbonden"
                  : gmail.sendAs
                    ? `${SEND_AS_LABEL[gmail.sendAs.status]} (gecontroleerd ${new Date(gmail.sendAs.checkedAt).toLocaleString("nl-NL")})`
                    : "Send-as alias nog niet gecontroleerd"}
              </dd>
            </div>
          </dl>
          {gmail.connected && gmail.sendAs && gmail.sendAs.status !== "verified" && gmail.sendAs.reason && (
            <p role="alert" className="mt-1 text-xs text-amber-400">
              Outreach verzenden is geblokkeerd tot dit is opgelost: {gmail.sendAs.reason}
            </p>
          )}
          {!gmail.connected && gmail.configured && (
            <p className="mt-1 text-xs text-amber-400">
              Log bij Google in met {gmail.requiredAccountKey} (het primaire account; niet met {gmail.sendAsEmail}, dat is een alias en geen
              login). Na koppelen controleert het systeem via de Gmail API of {gmail.sendAsEmail} als geverifieerd &quot;Verzenden als&quot;-alias op
              dat account staat; de bijbehorende Gmail-handtekening van het alias wordt dan één keer onder elke mail gezet.
            </p>
          )}
          {gmail.connected && !gmail.signatureScope && (
            <p className="mt-1 text-xs text-amber-400">
              Deze koppeling mist de instellingen-scope: de &quot;Verzenden als&quot;-lijst en handtekening kunnen niet gelezen worden. Verbreek de
              verbinding en koppel opnieuw.
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
              Verkeerd Google-account: je autoriseerde {flash.authorized ?? "een ander adres"}, maar het primaire account moet{" "}
              {flash.required ?? gmail.requiredAccountKey} zijn. Er is niets opgeslagen. Log bij Google in met {flash.required ?? gmail.requiredAccountKey} en
              probeer opnieuw; {gmail.sendAsEmail} blijft daarvan het &quot;Verzenden als&quot;-alias.
            </p>
          ) : (
            flash.error && <p role="alert" className="mt-1 text-xs text-amber-400">Gmail-actie mislukt ({flash.error}). Probeer het opnieuw.</p>
          )}
          {flash.connected && !flash.error && (
            <p role="status" className={`mt-1 text-xs ${flash.sendAsStatus ? "text-amber-400" : "text-emerald-400"}`}>
              {flash.sendAsStatus
                ? `Gmail-account verbonden, maar ${SEND_AS_LABEL[flash.sendAsStatus] ?? flash.sendAsStatus} (zie de reden hierboven).`
                : `Gmail-account verbonden; ${gmail.sendAsEmail} is als geverifieerd "Verzenden als"-alias bevestigd.`}
            </p>
          )}
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
              <button className={buttonClasses("secondary")} disabled={pending} onClick={() => run(recheckGmailSendAs)}>
                {pending ? "Bezig" : "Controleer send-as alias"}
              </button>
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
