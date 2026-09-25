/**
 * Gmail "Verzenden als"-alias (settings.sendAs) — pure resolutielogica.
 *
 * Architectuur (Silvijn, 2026-09-25): het primaire Google Workspace-account
 * (silvijn@silvijnstudio.com) wordt via OAuth gekoppeld; info@silvijnstudio.com
 * is daarvan een Send-As-alias, geen aparte gebruiker. Outreach gebruikt het
 * alias als zichtbaar From-adres, uitsluitend nadat de Gmail API heeft
 * bevestigd dat het alias op het account bestaat én geverifieerd is. Antwoorden
 * komen daardoor gewoon in dezelfde Gmail-inbox/thread terug.
 *
 * Deze module maakt nooit gebruikers of aliassen aan en wijzigt niets in
 * Google Workspace; ze leest alleen en legt exact uit wat ontbreekt.
 */

export interface GmailSendAsAlias {
  readonly sendAsEmail: string;
  readonly displayName: string | null;
  readonly isPrimary: boolean;
  readonly isDefault: boolean;
  readonly treatAsAlias: boolean;
  /** Gmail: "accepted" | "pending" | "verificationStatusUnspecified"; primair adres heeft er geen. */
  readonly verificationStatus: string | null;
  readonly signatureHtml: string | null;
}

export type SendAsStatus = "verified" | "pending" | "not_listed" | "unknown";

export type SendAsResolution =
  | { readonly ok: true; readonly status: "verified"; readonly alias: GmailSendAsAlias }
  | { readonly ok: false; readonly status: Exclude<SendAsStatus, "verified">; readonly reason: string };

/** Ruwe Gmail API-respons (settings.sendAs.list) → gevalideerde aliaslijst; onbekende velden genegeerd. */
export function parseSendAsList(raw: unknown): GmailSendAsAlias[] {
  const items = raw && typeof raw === "object" && Array.isArray((raw as { sendAs?: unknown }).sendAs)
    ? ((raw as { sendAs: unknown[] }).sendAs)
    : [];
  const aliases: GmailSendAsAlias[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const email = typeof rec.sendAsEmail === "string" ? rec.sendAsEmail.trim().toLowerCase() : "";
    if (!email) continue;
    const signature = typeof rec.signature === "string" ? rec.signature.trim() : "";
    aliases.push({
      sendAsEmail: email,
      displayName: typeof rec.displayName === "string" && rec.displayName.trim() ? rec.displayName.trim() : null,
      isPrimary: rec.isPrimary === true,
      isDefault: rec.isDefault === true,
      treatAsAlias: rec.treatAsAlias === true,
      verificationStatus: typeof rec.verificationStatus === "string" ? rec.verificationStatus : null,
      signatureHtml: signature.length > 0 ? signature : null,
    });
  }
  return aliases;
}

/**
 * Zoekt het gewenste alias in de lijst van het gekoppelde account en beslist
 * of het als From-adres mag dienen. Alleen "accepted" (of het primaire adres
 * zelf) telt als geverifieerd; elke andere uitkomst benoemt exact welke
 * Gmail/Workspace-instelling ontbreekt.
 */
export function resolveSendAsAlias(
  aliases: readonly GmailSendAsAlias[],
  wantedEmail: string,
  accountEmail: string
): SendAsResolution {
  const wanted = wantedEmail.trim().toLowerCase();
  const account = accountEmail.trim().toLowerCase();
  const alias = aliases.find((a) => a.sendAsEmail === wanted);
  if (!alias) {
    return {
      ok: false,
      status: "not_listed",
      reason:
        `${wanted} staat niet in de "Verzenden als"-lijst (settings.sendAs) van ${account}. ` +
        `Ontbrekende instelling: Gmail (${account}) → Instellingen → Alle instellingen → Accounts en import → ` +
        `"E-mail verzenden als" → "Nog een e-mailadres toevoegen" → ${wanted} met "Behandelen als alias" aangevinkt. ` +
        `Voorwaarde in Google Workspace Admin: ${wanted} moet als e-mailalias op de gebruiker ${account} staan ` +
        `(Gebruikers → ${account} → Gebruikersgegevens → Alternatieve e-mailadressen). Er wordt niets automatisch aangemaakt.`,
    };
  }
  if (alias.isPrimary || alias.sendAsEmail === account) {
    return { ok: true, status: "verified", alias };
  }
  if (alias.verificationStatus === "accepted") {
    return { ok: true, status: "verified", alias };
  }
  if (alias.verificationStatus === "pending") {
    return {
      ok: false,
      status: "pending",
      reason:
        `${wanted} staat wel in "Verzenden als" van ${account}, maar de verificatie is nog niet voltooid (verificationStatus=pending). ` +
        `Ontbrekende stap: bevestig de verificatiemail/-code van Gmail voor ${wanted} (Gmail → Instellingen → Accounts en import → "E-mail verzenden als" → Verifiëren).`,
    };
  }
  return {
    ok: false,
    status: "unknown",
    reason:
      `${wanted} staat in "Verzenden als" van ${account}, maar Gmail meldt geen geverifieerde status (verificationStatus=${alias.verificationStatus ?? "onbekend"}). ` +
      `Controleer het alias onder Gmail → Instellingen → Accounts en import → "E-mail verzenden als".`,
  };
}

/**
 * RFC 5322 From-header voor het geverifieerde alias: weergavenaam uit Gmail
 * (nooit verzonnen), anders alleen het adres. Nooit een hardcoded waarde.
 */
export function buildFromHeader(alias: Pick<GmailSendAsAlias, "sendAsEmail" | "displayName">): string {
  const name = (alias.displayName ?? "").replace(/[\r\n"]/g, "").trim();
  return name ? `"${name}" <${alias.sendAsEmail}>` : alias.sendAsEmail;
}
