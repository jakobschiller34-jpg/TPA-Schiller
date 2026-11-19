// Sekundengenaue Herzfrequenz nachladen: pro Aktivität ein Strava-Stream → HF-Histogramm in Firestore.
//
// Gespeichert werden nur das Histogramm (Sekunden pro 5-bpm-Bereich) und Markierungen,
// keine Rohdaten. Strava-Limit: ca. 100 Anfragen / 15 Min., 1000 / Tag → in Portionen arbeiten.

import { updateActivity } from "./firebase.js";
import { fetchHrHistogram } from "./strava.js";

/** Standard-Portion pro Durchlauf – lässt Puffer für Import und andere Anfragen. */
export const DEFAULT_MAX_REQUESTS = 80;

/** Aktivitäten mit HF, deren Stream noch nicht ausgewertet wurde (neueste zuerst). */
export function pendingHrActivities(activities) {
  return activities
    .filter((a) => a.averageHeartrate && !a.hrChecked)
    .sort((a, b) => (b.startEpoch ?? 0) - (a.startEpoch ?? 0));
}

/**
 * Lädt HF-Streams für ausstehende Aktivitäten und speichert die Histogramme.
 * Bricht beim Strava-Limit (429) sauber ab; bereits Erledigtes bleibt gespeichert.
 * @param {{ activities: object[], maxRequests?: number, onProgress?: (done: number, total: number) => void }} options
 * @returns {Promise<{ done: number, remaining: number, rateLimited: boolean }>}
 */
export async function backfillHrDetails({ activities, maxRequests = DEFAULT_MAX_REQUESTS, onProgress }) {
  const pending = pendingHrActivities(activities);
  const batch = pending.slice(0, maxRequests);
  let done = 0;
  try {
    for (const activity of batch) {
      const result = await fetchHrHistogram(activity.id);
      const fields = {
        hrHistogram: result?.histogram ?? null,
        hrSeconds: result?.seconds ?? 0,
        hrChecked: true, // auch ohne Stream markieren, damit nicht erneut angefragt wird
      };
      await updateActivity(activity.id, fields);
      Object.assign(activity, fields); // lokale Liste aktuell halten
      done += 1;
      onProgress?.(done, batch.length);
    }
  } catch (error) {
    if (error.rateLimited) return { done, remaining: pending.length - done, rateLimited: true };
    throw error;
  }
  return { done, remaining: pending.length - done, rateLimited: false };
}
