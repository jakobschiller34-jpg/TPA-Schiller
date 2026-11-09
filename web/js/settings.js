// Schlüssel und Tokens zur Laufzeit in localStorage verwalten.
//
// Diese Werte dürfen NIEMALS im Code, im Repository oder in Firestore landen.
// Sie liegen ausschließlich im localStorage dieses Browsers auf diesem Gerät.
// Hinweis: Jedes Skript, das auf dieser Seite läuft, kann localStorage lesen.
// Deshalb keine fremden Skripte einbinden und Nutzereingaben nie als HTML rendern.

const PREFIX = "tpa.";

/** Alle Schlüssel, die die App kennt, mit Beschriftung für die Einstellungsseite. */
export const SETTING_KEYS = {
  stravaClientId: { label: "Strava Client ID", secret: false, editable: true },
  stravaClientSecret: { label: "Strava Client Secret", secret: true, editable: true },
  anthropicApiKey: { label: "Anthropic API-Key", secret: true, editable: true },
  // Werden später automatisch durch den Strava-OAuth-Ablauf gesetzt:
  stravaAccessToken: { label: "Strava Access Token", secret: true, editable: false },
  stravaRefreshToken: { label: "Strava Refresh Token", secret: true, editable: false },
  stravaExpiresAt: { label: "Strava Token läuft ab (Unix-Zeit)", secret: false, editable: false },
};

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

/** Entfernt alle Schlüssel und Tokens dieser App aus localStorage. */
export function clearAllSettings() {
  try {
    for (const key of Object.keys(SETTING_KEYS)) localStorage.removeItem(PREFIX + key);
    return true;
  } catch {
    return false;
  }
}
