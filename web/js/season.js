// Saisonplan bis zum Laufwettkampf: Wochenliste berechnen und Soll/Ist je Woche auswerten.
// Reine Berechnungen ohne Netzwerkzugriff.

import { localDay, sportGroup, todayDay, weekStart } from "./analysis.js";

const DAY = 24 * 3600 * 1000;
export const MAX_SEASON_WEEKS = 30;

export const PHASES = ["Grundlage", "Aufbau", "Spezifisch", "Tapering", "Wettkampf", "Erholung"];

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const isoToDay = (iso) => Date.parse(`${iso}T00:00:00Z`);

/**
 * Montage aller Wochen von der aktuellen Woche bis zur Wettkampfwoche (inklusive).
 * @returns {string[]} ISO-Daten (JJJJ-MM-TT), höchstens MAX_SEASON_WEEKS
 */
export function seasonWeekStarts(raceDate, now = new Date()) {
  if (!raceDate) return [];
  const first = weekStart(todayDay(now));
  const last = weekStart(isoToDay(raceDate));
  const weeks = [];
  for (let w = first; w <= last && weeks.length < MAX_SEASON_WEEKS; w += 7 * DAY) weeks.push(isoDay(w));
  return weeks;
}

/** Anzahl der Tage aus `daySet` (ISO-Daten) in der Woche ab `start`. */
function countInWeek(daySet, start) {
  let count = 0;
  for (let d = 0; d < 7; d++) if (daySet?.has(isoDay(start + d * DAY))) count++;
  return count;
}

/**
 * Ist-Werte einer Woche (Montag bis Sonntag).
 * @param {{ strength: Set<string>, mobility: Set<string> }} [athletics] plan-tracking.athleticsDays()
 */
export function weekActuals(weekStartIso, activities, athletics = null) {
  const start = isoToDay(weekStartIso);
  const end = start + 7 * DAY;
  const actual = {
    runKm: 0,
    longRunKm: 0,
    rideHours: 0,
    strengthSessions: countInWeek(athletics?.strength, start),
    mobilitySessions: countInWeek(athletics?.mobility, start),
  };
  for (const a of activities) {
    const day = localDay(a);
    if (day < start || day >= end) continue;
    const group = sportGroup(a.sportType);
    if (group === "run") {
      const km = (a.distance ?? 0) / 1000;
      actual.runKm += km;
      actual.longRunKm = Math.max(actual.longRunKm, km);
    } else if (group === "ride") {
      actual.rideHours += (a.movingTime ?? 0) / 3600;
    }
  }
  return actual;
}

/** Anteil Ist/Soll, gedeckelt auf 1. null, wenn kein Soll. */
const ratio = (actual, target) => (target > 0 ? Math.min(1, actual / target) : null);

/**
 * Wertet alle Wochen des Saisonplans aus.
 * Erfüllung = Mittelwert aus Lauf-km, langem Lauf, Rad-Stunden, Kraft- und Dehneinheiten
 * (jeweils max. 100 %, nur Ziele > 0; ältere Pläne ohne Kraft-/Dehnziele wie bisher).
 * Laufende Woche: Erfüllung wird angezeigt, zählt aber noch nicht in die Saison-Quote.
 */
export function evaluateSeason(plan, activities, now = new Date(), athletics = null) {
  const thisWeek = weekStart(todayDay(now));
  return (plan?.weeks ?? []).map((week) => {
    const start = isoToDay(week.weekStart);
    const actual = weekActuals(week.weekStart, activities, athletics);
    const parts = [
      ratio(actual.runKm, week.runKm),
      ratio(actual.longRunKm, week.longRunKm),
      ratio(actual.rideHours, week.rideHours),
      ratio(actual.strengthSessions, week.strengthSessions),
      ratio(actual.mobilitySessions, week.mobilitySessions),
    ].filter((r) => r !== null);
    const fulfilment = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
    const state = start < thisWeek ? "past" : start === thisWeek ? "current" : "future";
    return { ...week, actual, fulfilment: state === "future" ? null : fulfilment, state };
  });
}

/** Saison-Quote über abgeschlossene Wochen. */
export function seasonStats(evaluated) {
  const past = evaluated.filter((w) => w.state === "past" && w.fulfilment !== null);
  return {
    weeks: past.length,
    rate: past.length ? past.reduce((sum, w) => sum + w.fulfilment, 0) / past.length : null,
  };
}

/** Ziele der aktuellen und der nächsten Woche (für die 7-Tage-Empfehlung). */
export function currentSeasonContext(plan, now = new Date(), athletics = null) {
  if (!plan?.weeks?.length) return null;
  const thisWeek = isoDay(weekStart(todayDay(now)));
  const index = plan.weeks.findIndex((w) => w.weekStart === thisWeek);
  if (index === -1) return null;
  const pick = (w) =>
    w && {
      weekStart: w.weekStart,
      phase: w.phase,
      focus: w.focus,
      runKm: w.runKm,
      longRunKm: w.longRunKm,
      rideHours: w.rideHours,
      strengthSessions: w.strengthSessions ?? null,
      mobilitySessions: w.mobilitySessions ?? null,
      keySessions: w.keySessions,
      recoveryWeek: w.recoveryWeek,
    };
  const current = pick(plan.weeks[index]);
  if (athletics) {
    // Strava kennt manuell abgehakte Kraft-/Dehneinheiten nicht → Gemini mitteilen, was schon erledigt ist.
    const start = isoToDay(current.weekStart);
    current.doneSoFar = {
      strengthSessions: countInWeek(athletics.strength, start),
      mobilitySessions: countInWeek(athletics.mobility, start),
    };
  }
  return {
    weekNumber: index + 1,
    totalWeeks: plan.weeks.length,
    thisWeek: current,
    nextWeek: pick(plan.weeks[index + 1]) ?? null,
  };
}
