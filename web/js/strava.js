// Strava-Anbindung – nur Gerüst, noch keine Funktionalität.
//
// Doku: https://developers.strava.com/docs/authentication/
//       https://developers.strava.com/docs/reference/#api-Activities-getLoggedInAthleteActivities
//
// Ablauf (geplant):
//   1. buildAuthorizeUrl() → Weiterleitung zu Strava, Nutzer stimmt zu
//   2. Strava leitet zurück auf redirect_uri?code=…&scope=…&state=…  (Query, nicht Hash!)
//   3. app.js erkennt den Callback und ruft handleCallback() auf
//   4. Code gegen Tokens tauschen, Tokens nur in localStorage speichern (settings.js)
//   5. fetchActivities() lädt Aktivitäten, refreshTokenIfNeeded() erneuert abgelaufene Tokens

import { getSetting } from "./settings.js";

export const STRAVA_AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
export const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
export const STRAVA_API_BASE = "https://www.strava.com/api/v3";
export const STRAVA_SCOPE = "activity:read_all";

const STATE_KEY = "tpa.stravaOAuthState"; // sessionStorage, nur für die Dauer des Logins

/** Redirect-URI = aktuelle Seite ohne Query und Hash (lokal wie auf GitHub Pages). */
export function getRedirectUri() {
  return `${location.origin}${location.pathname}`;
}

/** Baut die Strava-Authorize-URL. */
export function buildAuthorizeUrl() {
  const clientId = getSetting("stravaClientId");
  if (!clientId) throw new Error("Bitte zuerst die Strava Client ID in den Einstellungen eintragen.");

  // TODO: zufälligen state erzeugen (crypto.getRandomValues), in sessionStorage[STATE_KEY] ablegen
  // TODO: URL zusammenbauen:
  //   client_id, redirect_uri = getRedirectUri(), response_type = "code",
  //   approval_prompt = "auto", scope = STRAVA_SCOPE, state
  void STATE_KEY;
  throw new Error("TODO: buildAuthorizeUrl ist noch nicht umgesetzt.");
}

/**
 * Verarbeitet die Rückleitung von Strava.
 * @param {URLSearchParams} params Query-Parameter der Rückleitung (code, scope, state, error)
 */
export async function handleCallback(params) {
  // TODO: params.get("error") behandeln (z. B. "access_denied")
  // TODO: state mit sessionStorage[STATE_KEY] vergleichen, danach entfernen
  // TODO: prüfen, ob params.get("scope") "activity:read_all" enthält
  // TODO: POST STRAVA_TOKEN_URL mit client_id, client_secret, code, grant_type=authorization_code
  //       !!! OFFEN: Erlaubt Strava diesen Aufruf direkt aus dem Browser (CORS)? Zuerst testen.
  // TODO: access_token, refresh_token, expires_at per setSetting() speichern – NICHT in Firestore
  void params;
  throw new Error("TODO: handleCallback ist noch nicht umgesetzt.");
}

/** Erneuert den Access Token, wenn er abgelaufen ist oder bald abläuft. */
export async function refreshTokenIfNeeded() {
  // TODO: stravaExpiresAt prüfen (mit Puffer, z. B. 5 Minuten)
  // TODO: POST STRAVA_TOKEN_URL mit grant_type=refresh_token
  // TODO: neue Tokens speichern (Strava kann auch einen neuen Refresh Token liefern)
  throw new Error("TODO: refreshTokenIfNeeded ist noch nicht umgesetzt.");
}

/**
 * Lädt Aktivitäten des eingeloggten Athleten.
 * @param {{ after?: number, page?: number, perPage?: number }} options
 */
export async function fetchActivities({ after, page = 1, perPage = 100 } = {}) {
  // TODO: await refreshTokenIfNeeded()
  // TODO: GET `${STRAVA_API_BASE}/athlete/activities?after=…&page=…&per_page=…`
  //       Header: Authorization: Bearer <access token>
  // TODO: Rate-Limits beachten (Standard: 100 Requests / 15 min, 1000 / Tag;
  //       Header X-RateLimit-Limit / X-RateLimit-Usage auswerten, bei 429 abbrechen)
  // TODO: Aktivitäten normalisieren und in Firestore unter users/{uid}/activities speichern
  void after;
  void page;
  void perPage;
  throw new Error("TODO: fetchActivities ist noch nicht umgesetzt.");
}
