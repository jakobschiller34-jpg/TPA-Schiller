// Abgleich der Schlüssel zwischen localStorage und Firestore (users/{uid}/private/secrets).
//
// Firestore ist die Ablage für alle Geräte, localStorage die Arbeitskopie im Browser.
// Zugriff auf das Firestore-Dokument hat laut firestore.rules nur der angemeldete Eigentümer.

import {
  deleteSecretsFromFirestore,
  loadSecretsFromFirestore,
  saveSecretsToFirestore,
} from "./firebase.js";
import { getSetting, setSetting, SYNC_KEYS, TOKEN_KEYS } from "./settings.js";

const expiresOf = (source) => Number(source?.stravaExpiresAt) || 0;

/** Lädt die lokal gespeicherten Schlüssel nach Firestore hoch. Gibt die Anzahl zurück. */
export async function pushSecrets() {
  const values = Object.fromEntries(SYNC_KEYS.map((key) => [key, getSetting(key)]));
  const count = Object.values(values).filter(Boolean).length;
  if (count === 0) throw new Error("Es sind noch keine Schlüssel lokal eingetragen.");
  await saveSecretsToFirestore(values, SYNC_KEYS);
  return count;
}

/**
 * Holt die Schlüssel aus Firestore in den localStorage.
 * @param {{ overwrite?: boolean }} options overwrite=false lässt vorhandene lokale Werte stehen.
 * @returns {Promise<number>} Anzahl übernommener Schlüssel
 */
export async function pullSecrets({ overwrite = true } = {}) {
  const remote = await loadSecretsFromFirestore();
  let count = 0;
  if ((await reconcileStravaTokens(remote)) === "pulled") count += TOKEN_KEYS.length;
  for (const key of SYNC_KEYS) {
    if (TOKEN_KEYS.includes(key)) continue; // Tokens: siehe reconcileStravaTokens
    const value = remote[key];
    if (typeof value !== "string" || !value) continue; // unbekannte Felder ignorieren
    if (!overwrite && getSetting(key)) continue;
    if (setSetting(key, value)) count += 1;
  }
  return count;
}

/** Nach dem Login: fehlende lokale Schlüssel ergänzen und Strava-Tokens abgleichen. */
export async function pullMissingSecrets() {
  return pullSecrets({ overwrite: false });
}

// ---------- Strava-Tokens ----------

function localTokens() {
  return Object.fromEntries(TOKEN_KEYS.map((key) => [key, getSetting(key)]));
}

/**
 * Gleicht die Strava-Tokens ab: Die Fassung mit dem späteren Ablaufzeitpunkt gewinnt.
 * @param {object} [remote] bereits geladenes Firestore-Dokument
 * @returns {Promise<"pulled"|"pushed"|"same">}
 */
export async function reconcileStravaTokens(remote) {
  remote ??= await loadSecretsFromFirestore();
  const local = localTokens();
  const remoteComplete = TOKEN_KEYS.every((key) => typeof remote[key] === "string" && remote[key]);
  if (remoteComplete && expiresOf(remote) > expiresOf(local)) {
    for (const key of TOKEN_KEYS) setSetting(key, remote[key]);
    return "pulled";
  }
  if (local.stravaRefreshToken && expiresOf(local) > expiresOf(remote)) {
    await saveSecretsToFirestore(local, SYNC_KEYS);
    return "pushed";
  }
  return "same";
}

/** Nach Verbinden/Erneuern: Tokens hochladen (still, falls nicht angemeldet → später beim Login). */
export async function pushStravaTokens() {
  try {
    await saveSecretsToFirestore(localTokens(), SYNC_KEYS);
  } catch (error) {
    console.warn("Strava-Tokens hochladen:", error.message);
  }
}

/** Nach „Verbindung trennen“: Tokens auch in Firestore entfernen. */
export async function clearRemoteStravaTokens() {
  try {
    await saveSecretsToFirestore({}, SYNC_KEYS, { remove: TOKEN_KEYS });
  } catch (error) {
    console.warn("Strava-Tokens in Firestore löschen:", error.message);
  }
}

export async function deleteRemoteSecrets() {
  await deleteSecretsFromFirestore();
}
