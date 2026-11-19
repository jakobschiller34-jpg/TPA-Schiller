// Planerfüllung: geplante Tage (aus der Gemini-Empfehlung) mit importierten Aktivitäten abgleichen.
//
// Reine Berechnungen ohne Netzwerkzugriff. Manuelle Häkchen (checks) überstimmen die Automatik:
//   checks = { "JJJJ-MM-TT": { status: "done" | "skipped", extra: true | false } }

import { localDay, sportGroup, todayDay } from "./analysis.js";

const DAY = 24 * 3600 * 1000;

/** Anteil der geplanten Dauer, ab dem eine Kerneinheit als erledigt gilt. */
export const DONE_RATIO = 0.7;
/** Anteil der Zusatzdauer, der als Mehrzeit zusammenkommen muss. */
export const EXTRA_RATIO = 0.5;

/** Strava-Typen für „Kraft/Mobilität“. */
const STRENGTH_TYPES = ["WeightTraining", "Workout", "Yoga", "Pilates", "Crossfit", "HighIntensityIntervalTraining"];
/** Zählen an Ruhetagen nicht als Training. */
const REST_FRIENDLY_TYPES = ["Walk", "Hike"];

/** Punkte pro Status für die Disziplin-Quote. null = zählt (noch) nicht. */
export const STATUS_INFO = {
  done: { label: "erledigt", icon: "✓", points: 1, level: "ok" },
  rest_kept: { label: "Ruhetag eingehalten", icon: "✓", points: 1, level: "ok" },
  partial: { label: "teilweise", icon: "◐", points: 0.5, level: "warn" },
  other_sport: { label: "anders trainiert", icon: "◐", points: 0.5, level: "warn" },
  rest_trained: { label: "trainiert statt Ruhe", icon: "◐", points: 0.5, level: "warn" },
  missed: { label: "verpasst", icon: "✗", points: 0, level: "high" },
  skipped: { label: "ausgelassen", icon: "✗", points: 0, level: "high" },
  today: { label: "heute offen", icon: "○", points: null, level: "neutral" },
  planned: { label: "geplant", icon: "○", points: null, level: "neutral" },
};

const isoToDay = (iso) => Date.parse(`${iso}T00:00:00Z`);

function matchesSport(planSport, activity) {
  if (planSport === "Laufen") return sportGroup(activity.sportType) === "run";
  if (planSport === "Rad") return sportGroup(activity.sportType) === "ride";
  if (planSport === "Kraft/Mobilität") return STRENGTH_TYPES.includes(activity.sportType);
  return false;
}

const minutesOf = (list) => list.reduce((sum, a) => sum + (a.movingTime ?? 0) / 60, 0);

/**
 * Bewertet einen Plantag.
 * @returns {{ date, session, status, auto, manual, actual: object[], actualMinutes, extraDone, extraAuto }}
 */
export function evaluateDay(session, activities, check = {}, now = new Date()) {
  const day = isoToDay(session.date);
  const today = todayDay(now);
  const actual = activities.filter((a) => localDay(a) === day);
  const training = actual.filter((a) => !REST_FRIENDLY_TYPES.includes(a.sportType));
  const matching = training.filter((a) => matchesSport(session.sport, a));
  const matchingMinutes = minutesOf(matching);
  const trainingMinutes = minutesOf(training);

  let auto;
  if (session.sport === "Ruhetag") {
    if (training.length) auto = "rest_trained";
    else auto = day < today ? "rest_kept" : day === today ? "today" : "planned";
  } else if (matching.length && matchingMinutes >= DONE_RATIO * (session.durationMin || 0)) {
    auto = "done";
  } else if (matching.length) {
    auto = day < today ? "partial" : "today"; // heute: Tag läuft noch, nicht vorzeitig abwerten
  } else if (training.length) {
    auto = day < today ? "other_sport" : "today";
  } else {
    auto = day < today ? "missed" : day === today ? "today" : "planned";
  }

  const extra = session.optionalExtra ?? null;
  const extraAuto =
    Boolean(extra) && auto === "done" && trainingMinutes - (session.durationMin || 0) >= EXTRA_RATIO * extra.durationMin;

  const manual = check.status ?? null;
  const status = manual === "done" ? (session.sport === "Ruhetag" ? "rest_kept" : "done") : manual === "skipped" ? "skipped" : auto;
  // Manuelles Häkchen gewinnt; automatisch zählt ein Extra nur, wenn die Kerneinheit erledigt ist.
  const extraDone = extra ? (typeof check.extra === "boolean" ? check.extra : extraAuto && status === "done") : false;

  return { date: session.date, session, status, auto, manual, actual, actualMinutes: trainingMinutes, extraDone, extraAuto };
}

/**
 * Bewertet alle Tage eines Plans.
 * @param {object} recommendation Gemini-Empfehlung mit nextSessions
 * @param {{ until?: string }} options until: erster Tag (ISO), ab dem ein neuerer Plan gilt
 */
export function evaluatePlan(recommendation, activities, checks = {}, { now = new Date(), until = null } = {}) {
  const sessions = (recommendation?.nextSessions ?? []).filter((s) => !until || s.date < until);
  return sessions.map((s) => evaluateDay(s, activities, checks[s.date] ?? {}, now));
}

/** Disziplin-Kennzahlen für bewertete Tage. */
export function disciplineStats(days) {
  const counted = days.filter((d) => STATUS_INFO[d.status]?.points !== null && STATUS_INFO[d.status]);
  const points = counted.reduce((sum, d) => sum + STATUS_INFO[d.status].points, 0);
  const withExtra = days.filter((d) => d.session.optionalExtra && STATUS_INFO[d.status]?.points !== null);
  return {
    countedDays: counted.length,
    fullDays: counted.filter((d) => STATUS_INFO[d.status].points === 1).length,
    points,
    rate: counted.length ? points / counted.length : null,
    extrasOffered: withExtra.length,
    extrasDone: withExtra.filter((d) => d.extraDone).length,
  };
}

/**
 * Disziplin über mehrere Pläne der letzten `days` Tage. Überschneiden sich Pläne, gilt ab dem
 * ersten Tag eines neueren Plans dieser.
 * @param {Array<{ recommendation, checks?, createdAtMs }>} analyses beliebige Reihenfolge
 */
export function historyStats(analyses, activities, { now = new Date(), days = 28 } = {}) {
  const sorted = analyses
    .filter((a) => a.recommendation?.nextSessions?.length)
    .sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0));
  const from = todayDay(now) - days * DAY;
  const all = [];
  sorted.forEach((analysis, i) => {
    const until = sorted[i + 1]?.recommendation.nextSessions[0]?.date ?? null;
    const evaluated = evaluatePlan(analysis.recommendation, activities, analysis.checks ?? {}, { now, until });
    all.push(...evaluated.filter((d) => isoToDay(d.date) > from));
  });
  return { ...disciplineStats(all), days: all };
}
