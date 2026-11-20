// Strava-Anbindung: OAuth, Token-Refresh, Aktivitäten laden.
//
// Doku: https://developers.strava.com/docs/authentication/
//       https://developers.strava.com/docs/reference/#api-Activities-getLoggedInAthleteActivities
//
// Ablauf:
//   1. startAuthorization() → Weiterleitung zu Strava, Nutzer stimmt zu
//   2. Strava leitet zurück auf redirect_uri?code=…&scope=…&state=…  (Query, nicht Hash!)
//   3. app.js erkennt den Callback und ruft handleCallback() auf
//   4. Code gegen Tokens tauschen, Tokens nur in localStorage speichern (settings.js)
//   5. fetchActivitiesSince() lädt Aktivitäten, getValidAccessToken() erneuert abgelaufene Tokens
//
// CORS: Strava antwortet auf /oauth/token und /api/v3 mit access-control-allow-origin: *
// (geprüft 2026-11-19), deshalb geht alles direkt aus dem Browser.

import { getSetting, setSetting } from "./settings.js";

export const STRAVA_AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
export const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
export const STRAVA_DEAUTHORIZE_URL = "https://www.strava.com/oauth/deauthorize";
export const STRAVA_API_BASE = "https://www.strava.com/api/v3";
export const STRAVA_SCOPE = "activity:read_all";

const STATE_KEY = "tpa.stravaOAuthState"; // sessionStorage, nur für die Dauer des Logins
const FLASH_KEY = "tpa.stravaFlash"; // Meldung nach der Rückleitung für die Seite #verbinden
const REFRESH_MARGIN_SECONDS = 5 * 60; // Token 5 Minuten vor Ablauf erneuern
const PER_PAGE = 200; // Maximum der Strava-API

// ---------- Hilfsfunktionen ----------

/** Redirect-URI = aktuelle Seite ohne Query und Hash (lokal wie auf GitHub Pages). */
export function getRedirectUri() {
  return `${location.origin}${location.pathname}`;
}

function requireClientCredentials() {
  const clientId = getSetting("stravaClientId");
  const clientSecret = getSetting("stravaClientSecret");
  if (!clientId || !clientSecret) {
    throw new Error("Bitte zuerst Strava Client ID und Client Secret unter Einstellungen eintragen.");
  }
  return { clientId, clientSecret };
}

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Haken für den geräteübergreifenden Abgleich der Tokens (von app.js gesetzt, siehe secrets-sync.js).
// strava.js kennt Firebase bewusst nicht.
const tokenHooks = { onStored: null, beforeRefresh: null, onCleared: null };

/** @param {{ onStored?: () => void, beforeRefresh?: () => Promise<void>, onCleared?: () => void }} hooks */
export function setTokenSyncHooks(hooks) {
  Object.assign(tokenHooks, hooks);
}

function storeTokens({ access_token, refresh_token, expires_at }) {
  setSetting("stravaAccessToken", access_token);
  setSetting("stravaRefreshToken", refresh_token);
  setSetting("stravaExpiresAt", String(expires_at));
  tokenHooks.onStored?.();
}

function clearTokens() {
  setSetting("stravaAccessToken", null);
  setSetting("stravaRefreshToken", null);
  setSetting("stravaExpiresAt", null);
  tokenHooks.onCleared?.();
}

function validStoredToken() {
  const accessToken = getSetting("stravaAccessToken");
  const expiresAt = Number(getSetting("stravaExpiresAt")) || 0;
  const now = Math.floor(Date.now() / 1000);
  return accessToken && expiresAt - now > REFRESH_MARGIN_SECONDS ? accessToken : null;
}

async function postToken(params) {
  const response = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    // Formular-Kodierung: "simple request", kein CORS-Preflight nötig
    body: new URLSearchParams(params),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.message ?? response.statusText;
    throw new Error(`Strava-Token-Anfrage fehlgeschlagen (${response.status}): ${detail}`);
  }
  return data;
}

// ---------- Meldung zwischen Rückleitung und Seite #verbinden ----------

function setFlash(text, kind) {
  try {
    sessionStorage.setItem(FLASH_KEY, JSON.stringify({ text, kind }));
  } catch {
    /* ignorieren */
  }
}

/** Liefert die Meldung der letzten Rückleitung (einmalig) oder null. */
export function takeFlash() {
  try {
    const raw = sessionStorage.getItem(FLASH_KEY);
    sessionStorage.removeItem(FLASH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ---------- Verbindungsstatus ----------

export function isConnected() {
  return Boolean(getSetting("stravaRefreshToken"));
}

/** Ablaufzeit des Access Tokens als Date oder null. */
export function tokenExpiry() {
  const expiresAt = Number(getSetting("stravaExpiresAt"));
  return expiresAt ? new Date(expiresAt * 1000) : null;
}

// ---------- OAuth ----------

/** Baut die Strava-Authorize-URL und merkt sich einen zufälligen state. */
export function buildAuthorizeUrl() {
  const { clientId } = requireClientCredentials();
  const state = randomState();
  sessionStorage.setItem(STATE_KEY, state);

  const url = new URL(STRAVA_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: "code",
    approval_prompt: "auto",
    scope: STRAVA_SCOPE,
    state,
  }).toString();
  return url.toString();
}

export function startAuthorization() {
  location.assign(buildAuthorizeUrl());
}

/**
 * Verarbeitet die Rückleitung von Strava und hinterlegt eine Meldung für #verbinden.
 * @param {URLSearchParams} params Query-Parameter der Rückleitung (code, scope, state, error)
 */
export async function handleCallback(params) {
  try {
    const error = params.get("error");
    if (error) {
      throw new Error(error === "access_denied" ? "Du hast den Zugriff bei Strava abgelehnt." : `Strava meldet: ${error}`);
    }

    const expectedState = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
    if (!expectedState || params.get("state") !== expectedState) {
      throw new Error("Ungültige Rückleitung (state passt nicht). Bitte erneut verbinden.");
    }

    const grantedScopes = (params.get("scope") ?? "").split(",");
    if (!grantedScopes.includes(STRAVA_SCOPE)) {
      throw new Error(
        "Strava hat den Zugriff auf alle Aktivitäten nicht erlaubt. Bitte erneut verbinden und den Haken bei „Daten zu deinen Aktivitäten anzeigen, auch private“ setzen.",
      );
    }

    const { clientId, clientSecret } = requireClientCredentials();
    const data = await postToken({
      client_id: clientId,
      client_secret: clientSecret,
      code: params.get("code"),
      grant_type: "authorization_code",
    });
    storeTokens(data);
    cacheAthlete(toAthlete(data.athlete)); // Profilbild/Name gleich mitnehmen

    const name = data.athlete?.firstname ? ` als ${data.athlete.firstname}` : "";
    setFlash(`Mit Strava verbunden${name}.`, "ok");
  } catch (error) {
    setFlash(error.message, "error");
    throw error;
  }
}

/** Gibt einen gültigen Access Token zurück und erneuert ihn bei Bedarf. */
export async function getValidAccessToken() {
  if (!getSetting("stravaRefreshToken")) {
    throw new Error("Nicht mit Strava verbunden. Bitte zuerst unter „Strava verbinden“ verbinden.");
  }
  const valid = validStoredToken();
  if (valid) return valid;

  // Vor dem Erneuern den neuesten Stand holen: Ein anderes Gerät hat evtl. schon erneuert
  // (und Strava dabei einen neuen Refresh Token ausgegeben).
  try {
    await tokenHooks.beforeRefresh?.();
  } catch (error) {
    console.warn("Strava-Tokens abgleichen:", error.message);
  }
  const synced = validStoredToken();
  if (synced) return synced;

  const { clientId, clientSecret } = requireClientCredentials();
  const data = await postToken({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: getSetting("stravaRefreshToken"),
  });
  storeTokens(data); // Strava kann dabei auch einen neuen Refresh Token liefern
  return data.access_token;
}

/** Widerruft den Zugriff bei Strava und löscht die lokalen Tokens. */
export async function disconnect() {
  try {
    const token = await getValidAccessToken();
    await fetch(STRAVA_DEAUTHORIZE_URL, { method: "POST", body: new URLSearchParams({ access_token: token }) });
  } finally {
    clearTokens();
    cacheAthlete(null);
  }
}

// ---------- API ----------

/** GET auf die Strava-API. Bei 404 wird null zurückgegeben (z. B. Aktivität ohne Streams). */
async function stravaGet(path, params = {}) {
  const token = await getValidAccessToken();
  const url = new URL(STRAVA_API_BASE + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (response.status === 401) {
    throw new Error("Strava hat den Zugriff abgelehnt (401). Bitte unter „Strava verbinden“ neu verbinden.");
  }
  if (response.status === 429) {
    // Limits: 100 Anfragen / 15 Min., 1000 / Tag. Die Rate-Limit-Header gibt Strava per CORS
    // nicht frei, deshalb reagieren wir nur auf 429.
    const error = new Error("Strava-Anfragelimit erreicht. Bitte in 15 Minuten erneut versuchen.");
    error.rateLimited = true;
    throw error;
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Strava-Anfrage fehlgeschlagen (${response.status}).`);
  }
  return response.json();
}

// ---------- Athletenprofil (Name + Profilbild) ----------

const ATHLETE_KEY = "tpa.stravaAthlete"; // localStorage-Cache, keine Geheimnisse

/**
 * Reduziert das Strava-Athletenobjekt auf Name und Bild-Link.
 * Ohne eigenes Bild liefert Strava einen relativen Platzhalter (z. B. "avatar/athlete/large.png")
 * – dann avatarUrl = null, die App zeigt Initialen.
 */
export function toAthlete(raw) {
  if (!raw) return null;
  const url = [raw.profile, raw.profile_medium].find((u) => typeof u === "string" && u.startsWith("https://"));
  return {
    id: raw.id ?? null,
    firstname: raw.firstname ?? "",
    lastname: raw.lastname ?? "",
    avatarUrl: url ?? null,
  };
}

export function cacheAthlete(athlete) {
  try {
    if (athlete) localStorage.setItem(ATHLETE_KEY, JSON.stringify(athlete));
    else localStorage.removeItem(ATHLETE_KEY);
  } catch {
    /* ignorieren */
  }
}

export function cachedAthlete() {
  try {
    return JSON.parse(localStorage.getItem(ATHLETE_KEY) ?? "null");
  } catch {
    return null;
  }
}

/** Lädt Name und Profilbild des verbundenen Athleten (Scope "read", immer enthalten). */
export async function fetchAthlete() {
  const athlete = toAthlete(await stravaGet("/athlete"));
  cacheAthlete(athlete);
  return athlete;
}

/** Eine Seite Aktivitäten des eingeloggten Athleten (Rohdaten von Strava). */
export async function fetchActivities({ after, before, page = 1, perPage = PER_PAGE } = {}) {
  return stravaGet("/athlete/activities", { after, before, page, per_page: perPage });
}

/**
 * Lädt alle Aktivitäten nach `after` (Unix-Sekunden), seitenweise.
 * @param {{ after: number, maxPages?: number, onPage?: (count: number, page: number) => void }} options
 * @returns {Promise<object[]>} normalisierte Aktivitäten
 */
export async function fetchActivitiesSince({ after, maxPages = 10, onPage } = {}) {
  const all = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await fetchActivities({ after, page });
    all.push(...batch.map(normalizeActivity));
    onPage?.(all.length, page);
    if (batch.length < PER_PAGE) break;
  }
  return all;
}

// ---------- Herzfrequenz-Streams ----------

export const HR_BIN_SIZE = 5; // bpm pro Histogramm-Bereich
const MAX_GAP_SECONDS = 30; // längere Lücken (Pausen, Aufzeichnungsstopp) zählen nicht

/**
 * Berechnet aus Zeit- und HF-Stream ein Histogramm: { "140": Sekunden, "145": … }.
 * Schlüssel = Untergrenze des 5er-Bereichs. Jede Zeitspanne zählt zur HF am Ende der Spanne.
 * @returns {{ histogram: Object<string, number>, seconds: number } | null}
 */
export function buildHrHistogram(time, heartrate) {
  if (!Array.isArray(time) || !Array.isArray(heartrate) || time.length !== heartrate.length) return null;
  const histogram = {};
  let seconds = 0;
  for (let i = 1; i < time.length; i += 1) {
    const dt = time[i] - time[i - 1];
    const hr = heartrate[i];
    if (!(dt > 0 && dt <= MAX_GAP_SECONDS) || !(hr > 0)) continue;
    const bin = String(Math.floor(hr / HR_BIN_SIZE) * HR_BIN_SIZE);
    histogram[bin] = (histogram[bin] ?? 0) + dt;
    seconds += dt;
  }
  return seconds > 0 ? { histogram, seconds } : null;
}

/**
 * Lädt den HF-Stream einer Aktivität und gibt das Histogramm zurück
 * (null, wenn die Aktivität keine HF-Daten hat). Kostet eine API-Anfrage.
 */
export async function fetchHrHistogram(activityId) {
  const streams = await stravaGet(`/activities/${activityId}/streams`, {
    keys: "time,heartrate",
    key_by_type: true,
  });
  return buildHrHistogram(streams?.time?.data, streams?.heartrate?.data);
}

/**
 * Reduziert eine Strava-Aktivität auf die Felder, die für die Analyse gebraucht werden.
 * Keine GPS-Daten (map/polyline), keine Start-/Endkoordinaten.
 * Fehlende Werte werden null (Firestore akzeptiert kein undefined).
 */
export function normalizeActivity(a) {
  const n = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return {
    id: a.id,
    name: a.name ?? "",
    sportType: a.sport_type ?? a.type ?? "Unknown",
    startDate: a.start_date ?? null, // ISO, UTC
    startDateLocal: a.start_date_local ?? null,
    startEpoch: a.start_date ? Math.floor(Date.parse(a.start_date) / 1000) : null,
    distance: n(a.distance), // Meter
    movingTime: n(a.moving_time), // Sekunden
    elapsedTime: n(a.elapsed_time), // Sekunden
    elevationGain: n(a.total_elevation_gain), // Meter
    averageSpeed: n(a.average_speed), // m/s
    maxSpeed: n(a.max_speed), // m/s
    averageHeartrate: n(a.average_heartrate),
    maxHeartrate: n(a.max_heartrate),
    averageWatts: n(a.average_watts),
    weightedAverageWatts: n(a.weighted_average_watts),
    kilojoules: n(a.kilojoules),
    averageCadence: n(a.average_cadence),
    sufferScore: n(a.suffer_score),
    trainer: Boolean(a.trainer),
    commute: Boolean(a.commute),
    manual: Boolean(a.manual),
  };
}
