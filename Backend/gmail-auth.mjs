/**
 * Gmail OAuth2 token handling — shared by whatever in the `mail` process
 * talks to Gmail.
 *
 * Extracted out of mail-server.mjs (which used to be, in its own words, "the
 * one place in PFO that knows what Gmail is") when mail-inbound.mjs needed
 * the same refresh-token dance for polling instead of sending. Both live in
 * the same process, so the module-level access-token cache below is shared
 * between them for free — sending and polling do not refresh the token
 * twice a minute apart.
 *
 * Same scope as before this extraction: get a usable access token, or throw
 * a typed error. Deciding what to DO with that token stays in the caller.
 */

const GMAIL = {
  clientId: process.env.PFO_GMAIL_CLIENT_ID ?? "",
  clientSecret: process.env.PFO_GMAIL_CLIENT_SECRET ?? "",
  refreshToken: process.env.PFO_GMAIL_REFRESH_TOKEN ?? "",
};

export function gmailMisconfiguration() {
  const missing = [];
  if (!GMAIL.clientId) missing.push("PFO_GMAIL_CLIENT_ID");
  if (!GMAIL.clientSecret) missing.push("PFO_GMAIL_CLIENT_SECRET");
  if (!GMAIL.refreshToken) missing.push("PFO_GMAIL_REFRESH_TOKEN");
  return missing;
}

/** Cached until shortly before expiry — Google issues these for an hour. */
let accessToken = null;

export async function gmailAccessToken() {
  if (accessToken && accessToken.expiresAt > Date.now() + 60_000) {
    return accessToken.value;
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GMAIL.clientId,
      client_secret: GMAIL.clientSecret,
      refresh_token: GMAIL.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.error_description ?? payload.error ?? `HTTP ${response.status}`;
    const error = new Error(`Google refused the refresh token: ${detail}`);
    error.aosFailureKind = "authentication";
    throw error;
  }

  accessToken = {
    value: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in ?? 3600) * 1000,
  };
  return accessToken.value;
}

/** Call after a 401 from Gmail — the cached token is no longer good and the
 * next call to gmailAccessToken() must re-authenticate rather than replay it. */
export function invalidateGmailAccessToken() {
  accessToken = null;
}
