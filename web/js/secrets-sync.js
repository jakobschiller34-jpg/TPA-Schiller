// Abgleich der Schlüssel zwischen localStorage und Firestore (users/{uid}/private/secrets).
//
// Firestore ist die Ablage für alle Geräte, localStorage die Arbeitskopie im Browser.
// Zugriff auf das Firestore-Dokument hat laut firestore.rules nur der angemeldete Eigentümer.

import {
  deleteSecretsFromFirestore,
  loadSecretsFromFirestore,
  saveSecretsToFirestore,
} from "./firebase.js";
import { getSetting, setSetting, SYNC_KEYS } from "./settings.js";

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
  for (const key of SYNC_KEYS) {
    const value = remote[key];
    if (typeof value !== "string" || !value) continue; // unbekannte Felder ignorieren
    if (!overwrite && getSetting(key)) continue;
    if (setSetting(key, value)) count += 1;
  }
  return count;
}

/** Nach dem Login: fehlende lokale Schlüssel still aus Firestore ergänzen. */
export async function pullMissingSecrets() {
  if (SYNC_KEYS.every((key) => getSetting(key))) return 0;
  return pullSecrets({ overwrite: false });
}

export async function deleteRemoteSecrets() {
  await deleteSecretsFromFirestore();
}
