import "server-only";
import { gmailListSendAs } from "./client";
import { GMAIL_SETTINGS_SCOPE } from "./config";
import { resolveSendAsAlias, type SendAsResolution } from "./send-as";
import { updateGmailSendAsSnapshot, type GmailSendAsSnapshot } from "./tokens";

/**
 * Live controle van het "Verzenden als"-alias tegen de Gmail API
 * (settings.sendAs.list("me")) voor het gekoppelde account, met vastlegging
 * van de uitkomst op de verbinding. Puur lezen bij Google; nooit aanmaken.
 */
export async function checkSendAsAlias(input: {
  accessToken: string;
  grantedScopes: string;
  accountEmail: string;
  sendAsEmail: string;
  persist?: boolean;
}): Promise<SendAsResolution> {
  const checkedAt = new Date().toISOString();
  let resolution: SendAsResolution;
  if (!input.grantedScopes.split(/\s+/).includes(GMAIL_SETTINGS_SCOPE)) {
    resolution = {
      ok: false,
      status: "unknown",
      reason:
        `De Gmail-koppeling mist de scope ${GMAIL_SETTINGS_SCOPE}; de "Verzenden als"-lijst kan niet gelezen worden. ` +
        `Verbreek de verbinding en koppel ${input.accountEmail} opnieuw (Google vraagt dan om de extra toestemming).`,
    };
  } else {
    try {
      const aliases = await gmailListSendAs(input.accessToken);
      resolution = resolveSendAsAlias(aliases, input.sendAsEmail, input.accountEmail);
    } catch (error) {
      resolution = {
        ok: false,
        status: "unknown",
        reason: `Gmail API settings.sendAs.list mislukte: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  if (input.persist !== false) {
    await updateGmailSendAsSnapshot(input.accountEmail, toSnapshot(resolution, input.sendAsEmail, checkedAt));
  }
  return resolution;
}

export function toSnapshot(resolution: SendAsResolution, sendAsEmail: string, checkedAt: string): GmailSendAsSnapshot {
  return resolution.ok
    ? { sendAsEmail, status: "verified", displayName: resolution.alias.displayName, reason: null, checkedAt }
    : { sendAsEmail, status: resolution.status, displayName: null, reason: resolution.reason, checkedAt };
}
