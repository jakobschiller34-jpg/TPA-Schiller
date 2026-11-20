// Schlüssel und Tokens zur Laufzeit in localStorage verwalten.
//
// Diese Werte dürfen NIEMALS im Code oder im Repository landen.
// Arbeitskopie: localStorage dieses Browsers. Die mit `sync: true` markierten Schlüssel
// können zusätzlich in Firestore (users/{uid}/private/secrets) abgelegt werden,
// damit sie auf jedem Gerät nach dem Login verfügbar sind (siehe secrets-sync.js).
// Hinweis: Jedes Skript, das auf dieser Seite läuft, kann localStorage lesen.
// Deshalb keine fremden Skripte einbinden und Nutzereingaben nie als HTML rendern.

const PREFIX = "tpa.";

/** Alle Schlüssel, die die App kennt, mit Beschriftung für die Einstellungsseite. */
export const SETTING_KEYS = {
  stravaClientId: { label: "Strava Client ID", secret: false, editable: true, sync: true },
  stravaClientSecret: { label: "Strava Client Secret", secret: true, editable: true, sync: true },
  geminiApiKey: { label: "Gemini API-Key", secret: true, editable: true, sync: true },
  // Werden automatisch durch den Strava-OAuth-Ablauf gesetzt und über Firestore abgeglichen,
  // damit die Strava-Verbindung auf allen Geräten/Adressen erhalten bleibt (siehe secrets-sync.js).
  stravaAccessToken: { label: "Strava Access Token", secret: true, editable: false, sync: true, token: true },
  stravaRefreshToken: { label: "Strava Refresh Token", secret: true, editable: false, sync: true, token: true },
  stravaExpiresAt: { label: "Strava Token läuft ab (Unix-Zeit)", secret: false, editable: false, sync: true, token: true },
};

/** Nicht mehr genutzte Schlüssel, die beim Löschen trotzdem mit entfernt werden. */
const LEGACY_KEYS = ["anthropicApiKey"];

function assertKnown(key) {
  if (!(key in SETTING_KEYS)) throw new Error(`Unbekannter Einstellungsschlüssel: ${key}`);
}

export function getSetting(key) {
  assertKnown(key);
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null; // z. B. privater Modus oder gesperrter Speicher
  }
}

export function setSetting(key, value) {
  assertKnown(key);
  try {
    if (value === null || value === undefined || value === "") {
      localStorage.removeItem(PREFIX + key);
    } else {
      localStorage.setItem(PREFIX + key, String(value));
    }
    return true;
  } catch {
    return false;
  }
}

export function hasSetting(key) {
  return Boolean(getSetting(key));
}

export function getAllSettings() {
  return Object.fromEntries(Object.keys(SETTING_KEYS).map((key) => [key, getSetting(key)]));
}

/** Schlüssel, die mit Firestore abgeglichen werden. */
export const SYNC_KEYS = Object.keys(SETTING_KEYS).filter((key) => SETTING_KEYS[key].sync);
/** Strava-Tokens: werden nicht einfach überschrieben, sondern die neuere Fassung gewinnt. */
export const TOKEN_KEYS = Object.keys(SETTING_KEYS).filter((key) => SETTING_KEYS[key].token);

/** Entfernt alle Schlüssel und Tokens dieser App aus localStorage. */
export function clearAllSettings() {
  try {
    for (const key of [...Object.keys(SETTING_KEYS), ...LEGACY_KEYS]) localStorage.removeItem(PREFIX + key);
    return true;
  } catch {
    return false;
  }
}
