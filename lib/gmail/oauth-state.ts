/**
 * Cookie-naam voor de Gmail-OAuth-state (CSRF-bescherming). Gedeeld
 * tussen de server action die de flow start en de callback-route die
 * de state verifieert.
 */
export const GMAIL_STATE_COOKIE = "gmail_oauth_state";
