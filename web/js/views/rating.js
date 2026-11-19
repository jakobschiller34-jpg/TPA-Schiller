// Kasten „Noch zu bewerten“: Anstrengung (RPE 1–10) und optionale Notiz nach einer Aktivität.
//
// Gespeichert im Aktivitäts-Dokument: rpe (1–10), note (max. 300 Zeichen), ratedAt (ms).
// „Überspringen“ setzt rpeSkipped, damit die Aktivität nicht erneut erscheint.

import { updateActivity } from "../firebase.js";
import { localDay, todayDay } from "../analysis.js";

const DAYS_BACK = 7;
export const NOTE_MAX = 300;

/** Kurzbeschreibung der RPE-Stufen (Borg CR10, vereinfacht). */
export const RPE_LABELS = {
  1: "sehr leicht",
  2: "leicht",
  3: "locker",
  4: "etwas fordernd",
  5: "fordernd",
  6: "deutlich fordernd",
  7: "hart",
  8: "sehr hart",
  9: "extrem hart",
  10: "maximal",
};

const DAY = 24 * 3600 * 1000;

/** Aktivitäten der letzten 7 Tage ohne Bewertung (neueste zuerst). */
export function unratedActivities(activities, now = new Date()) {
  const today = todayDay(now);
  return activities
    .filter((a) => a.rpe == null && !a.rpeSkipped)
    .filter((a) => {
      const day = localDay(a);
      return day > today - DAYS_BACK * DAY && day <= today;
    })
    .sort((a, b) => (b.startEpoch ?? 0) - (a.startEpoch ?? 0));
}

function button(text, className) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = text;
  return b;
}

/**
 * Rendert den Kasten in `section`. Ist nichts offen, wird er ausgeblendet.
 * @param {HTMLElement} section
 * @param {object[]} activities alle geladenen Aktivitäten (werden beim Speichern aktualisiert)
 * @param {{ describe: (a: object) => string, onChange: () => void }} options
 */
export function renderRatingCard(section, activities, { describe, onChange }) {
  const open = unratedActivities(activities);
  section.hidden = open.length === 0;
  section.replaceChildren();
  if (!open.length) return;

  const heading = document.createElement("h2");
  heading.textContent = `Noch zu bewerten (${open.length})`;
  const intro = document.createElement("p");
  intro.className = "muted";
  intro.textContent = "Wie anstrengend war es? 1 = sehr leicht, 10 = maximal. Fließt in Analyse und Gemini-Empfehlung ein.";
  section.append(heading, intro);

  for (const activity of open) {
    const item = document.createElement("div");
    item.className = "rating-item";

    const label = document.createElement("p");
    label.className = "rating-label";
    label.textContent = describe(activity);

    const scale = document.createElement("div");
    scale.className = "rpe-scale";
    scale.setAttribute("role", "group");
    scale.setAttribute("aria-label", "Anstrengung 1 bis 10");
    const scaleHint = document.createElement("p");
    scaleHint.className = "muted rpe-hint";
    scaleHint.textContent = "Bitte Anstrengung wählen";

    const note = document.createElement("input");
    note.type = "text";
    note.maxLength = NOTE_MAX;
    note.placeholder = "Notiz (optional): Schlaf, Wetter, Beine, Stimmung …";
    note.className = "rating-note";

    const save = button("Speichern", "button button-small");
    save.disabled = true;
    const skip = button("Überspringen", "button button-secondary button-small");
    const actions = document.createElement("div");
    actions.className = "button-row";
    actions.append(save, skip);

    let selected = null;
    for (let value = 1; value <= 10; value += 1) {
      const b = button(String(value), "rpe-button");
      b.title = RPE_LABELS[value];
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => {
        selected = value;
        for (const other of scale.children) other.setAttribute("aria-pressed", String(other === b));
        scaleHint.textContent = `${value} – ${RPE_LABELS[value]}`;
        save.disabled = false;
      });
      scale.append(b);
    }

    async function store(fields) {
      save.disabled = true;
      skip.disabled = true;
      try {
        await updateActivity(activity.id, fields);
        Object.assign(activity, fields);
        onChange();
      } catch (error) {
        scaleHint.textContent = `Speichern fehlgeschlagen: ${error.message}`;
        save.disabled = selected === null;
        skip.disabled = false;
      }
    }

    save.addEventListener("click", () =>
      store({ rpe: selected, note: note.value.trim().slice(0, NOTE_MAX), ratedAt: Date.now() }),
    );
    skip.addEventListener("click", () => store({ rpeSkipped: true }));

    item.append(label, scale, scaleHint, note, actions);
    section.append(item);
  }
}
