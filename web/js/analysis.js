// Trainingsanalyse – reine Berechnungen ohne Netzwerkzugriff.
//
// Grundlage sind die normalisierten Aktivitäten aus Firestore (siehe strava.normalizeActivity).
// Hauptsportarten: Laufen und Radfahren. Alle anderen Aktivitäten zählen nur zur Gesamtbelastung.
//
// Herzfrequenz: Ist für eine Aktivität ein HF-Histogramm vorhanden (hrHistogram, aus dem
// sekundengenauen Strava-Stream, siehe hr-details.js), wird die Zeit anteilig auf die Zonen
// verteilt. Sonst wird die ganze Aktivität anhand ihrer Ø-HF einer Zone zugeordnet –
// Intervalle erscheinen dann lockerer, als sie waren.

const DAY = 24 * 3600 * 1000;

export const SPORT_GROUPS = {
  run: { label: "Laufen", types: ["Run", "TrailRun", "VirtualRun"] },
  ride: { label: "Rad", types: ["Ride", "VirtualRide", "GravelRide", "MountainBikeRide"] },
  // E-Bike bewusst nicht beim Rad: Motorunterstützung verfälscht Umfang und Belastung.
};

/** Zonen-Untergrenzen als Anteil (HFmax bzw. HF-Reserve, wenn Ruhepuls bekannt). */
export const ZONES = [
  { zone: 1, label: "Z1 Regeneration", from: 0 },
  { zone: 2, label: "Z2 Grundlage", from: 0.6 },
  { zone: 3, label: "Z3 Tempo", from: 0.7 },
  { zone: 4, label: "Z4 Schwelle", from: 0.8 },
  { zone: 5, label: "Z5 Maximal", from: 0.9 },
];

/** Belastungsfaktor für Aktivitäten ohne Herzfrequenz (entspricht moderater Intensität). */
const NO_HR_FACTOR = 2;

// ---------- Grundfunktionen ----------

export function sportGroup(sportType) {
  for (const [key, group] of Object.entries(SPORT_GROUPS)) {
    if (group.types.includes(sportType)) return key;
  }
  return "other";
}

/**
 * Lokaler Kalendertag einer Aktivität als UTC-Mitternacht in ms.
 * start_date_local ist lokale Wanduhrzeit mit "Z" → UTC-Felder direkt verwenden.
 */
export function localDay(activity) {
  const d = new Date(activity.startDateLocal ?? activity.startDate);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Heute (lokale Zeit des Browsers) als UTC-Mitternacht in ms. */
export function todayDay(now = new Date()) {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Montag der Woche, in der `day` liegt (UTC-Mitternacht in ms). */
export function weekStart(day) {
  const dow = (new Date(day).getUTCDay() + 6) % 7; // Montag = 0
  return day - dow * DAY;
}

/** Herzfrequenz-Zone 1–5 oder null (ohne HF oder ohne Profil). */
export function hrZone(avgHr, profile) {
  const max = profile?.maxHeartrate;
  if (!avgHr || !max) return null;
  const rest = profile.restingHeartrate;
  const ratio = rest && rest < max ? (avgHr - rest) / (max - rest) : avgHr / max;
  let zone = 1;
  for (const z of ZONES) if (ratio >= z.from) zone = z.zone;
  return zone;
}

const HR_BIN_SIZE = 5; // muss zu strava.HR_BIN_SIZE passen

/**
 * Zeitanteile pro Zone (Index 1–5, Summe 1) oder null, wenn keine Zuordnung möglich ist.
 * Mit Histogramm: anteilig nach Sekunden (Bereichsmitte als HF). Sonst: 100 % in der Zone der Ø-HF.
 */
export function zoneShares(activity, profile) {
  if (!profile?.maxHeartrate) return null;
  const shares = [0, 0, 0, 0, 0, 0];
  const histogram = activity.hrHistogram;
  if (histogram && Object.keys(histogram).length) {
    let total = 0;
    for (const [bin, seconds] of Object.entries(histogram)) {
      const zone = hrZone(Number(bin) + HR_BIN_SIZE / 2, profile);
      shares[zone] += seconds;
      total += seconds;
    }
    return total ? shares.map((s) => s / total) : null;
  }
  const zone = hrZone(activity.averageHeartrate, profile);
  if (!zone) return null;
  shares[zone] = 1;
  return shares;
}

/** true, wenn die Aktivität sekundengenau (per Histogramm) ausgewertet wird. */
export function hasHrDetails(activity) {
  return Boolean(activity.hrHistogram && Object.keys(activity.hrHistogram).length);
}

/**
 * Belastung einer Aktivität: Minuten × Zonenfaktor (vereinfachter Edwards-TRIMP),
 * mit Histogramm zeitanteilig über alle Zonen. Ohne HF wird ein moderater Faktor angenommen.
 */
export function activityLoad(activity, profile) {
  const minutes = (activity.movingTime ?? 0) / 60;
  const shares = zoneShares(activity, profile);
  if (!shares) return minutes * NO_HR_FACTOR;
  return minutes * shares.reduce((acc, share, zone) => acc + share * zone, 0);
}

const sum = (values) => values.reduce((a, b) => a + b, 0);

function emptyTotals() {
  return { count: 0, distanceKm: 0, hours: 0, elevation: 0 };
}

function addTo(totals, a) {
  totals.count += 1;
  totals.distanceKm += (a.distance ?? 0) / 1000;
  totals.hours += (a.movingTime ?? 0) / 3600;
  totals.elevation += a.elevationGain ?? 0;
}

function pctChange(current, previous) {
  if (!previous) return current ? null : 0; // null = "neu", keine sinnvolle Prozentangabe
  return ((current - previous) / previous) * 100;
}

// ---------- Auswertungen ----------

/** Wochenübersicht der letzten `weeks` Wochen (inkl. laufender Woche), neueste zuerst. */
export function weeklySummary(activities, profile, { weeks = 12, now = new Date() } = {}) {
  const thisWeek = weekStart(todayDay(now));
  const result = [];
  for (let i = 0; i < weeks; i += 1) {
    const start = thisWeek - i * 7 * DAY;
    result.push({
      weekStart: start,
      current: i === 0,
      run: emptyTotals(),
      ride: emptyTotals(),
      other: emptyTotals(),
      totalHours: 0,
      load: 0,
      longestRunKm: 0,
      rpeSum: 0, // Summe der RPE-Werte bewerteter Aktivitäten
      rpeCount: 0,
      rpeLoad: 0, // Session-RPE (Foster): RPE × Minuten, nur bewertete Aktivitäten
    });
  }
  const byStart = new Map(result.map((w) => [w.weekStart, w]));
  for (const a of activities) {
    const week = byStart.get(weekStart(localDay(a)));
    if (!week) continue;
    const group = sportGroup(a.sportType);
    addTo(week[group], a);
    week.totalHours += (a.movingTime ?? 0) / 3600;
    week.load += activityLoad(a, profile);
    if (group === "run") week.longestRunKm = Math.max(week.longestRunKm, (a.distance ?? 0) / 1000);
    if (a.rpe) {
      week.rpeSum += a.rpe;
      week.rpeCount += 1;
      week.rpeLoad += a.rpe * ((a.movingTime ?? 0) / 60);
    }
  }
  for (const week of result) week.avgRpe = week.rpeCount ? week.rpeSum / week.rpeCount : null;
  return result;
}

/**
 * Belastungsverhältnis akut (7 Tage) zu chronisch (Ø pro Woche über 28 Tage).
 * Status-Grenzen nach gängiger ACWR-Faustregel.
 */
export function loadStatus(activities, profile, { now = new Date() } = {}) {
  const today = todayDay(now);
  const inLastDays = (a, days) => {
    const day = localDay(a);
    return day > today - days * DAY && day <= today;
  };
  const acute = sum(activities.filter((a) => inLastDays(a, 7)).map((a) => activityLoad(a, profile)));
  const chronic = sum(activities.filter((a) => inLastDays(a, 28)).map((a) => activityLoad(a, profile))) / 4;
  const ratio = chronic > 0 ? acute / chronic : null;

  let status = "keine Daten";
  let level = "neutral";
  if (ratio !== null) {
    if (ratio < 0.8) [status, level] = ["Entlastung / weniger als gewohnt", "low"];
    else if (ratio <= 1.3) [status, level] = ["im grünen Bereich", "ok"];
    else if (ratio <= 1.5) [status, level] = ["erhöht – auf Erholung achten", "warn"];
    else [status, level] = ["deutlich erhöht – Überlastungsrisiko", "high"];
  }
  return { acute, chronic, ratio, status, level };
}

/**
 * Zeitanteile pro Zone der letzten `days` Tage, getrennt nach Sportgruppe.
 * @returns {{ [group: string]: { minutes: number[6], noHrMinutes: number, total: number } }}
 *   minutes[1..5] = Minuten in Zone 1–5
 */
export function intensityDistribution(activities, profile, { days = 28, now = new Date() } = {}) {
  const today = todayDay(now);
  const result = {};
  for (const group of [...Object.keys(SPORT_GROUPS), "all"]) {
    result[group] = { minutes: [0, 0, 0, 0, 0, 0], noHrMinutes: 0, total: 0 };
  }
  for (const a of activities) {
    const day = localDay(a);
    if (day <= today - days * DAY || day > today) continue;
    const minutes = (a.movingTime ?? 0) / 60;
    const shares = zoneShares(a, profile);
    for (const group of [sportGroup(a.sportType), "all"]) {
      const bucket = result[group];
      if (!bucket) continue; // "other" nur in "all"
      bucket.total += minutes;
      if (shares) for (let z = 1; z <= 5; z += 1) bucket.minutes[z] += minutes * shares[z];
      else bucket.noHrMinutes += minutes;
    }
  }
  return result;
}

/** Vergleich letzte 4 Wochen (28 Tage) mit den 4 Wochen davor, pro Sportgruppe. */
export function trends(activities, { days = 28, now = new Date() } = {}) {
  const today = todayDay(now);
  const result = {};
  for (const group of Object.keys(SPORT_GROUPS)) {
    const current = emptyTotals();
    const previous = emptyTotals();
    let currentHrWeighted = 0;
    let currentHrMinutes = 0;
    let previousHrWeighted = 0;
    let previousHrMinutes = 0;
    let currentWattsWeighted = 0;
    let currentWattsMinutes = 0;
    for (const a of activities) {
      if (sportGroup(a.sportType) !== group) continue;
      const day = localDay(a);
      const minutes = (a.movingTime ?? 0) / 60;
      if (day > today - days * DAY && day <= today) {
        addTo(current, a);
        if (a.averageHeartrate) {
          currentHrWeighted += a.averageHeartrate * minutes;
          currentHrMinutes += minutes;
        }
        const watts = a.weightedAverageWatts ?? a.averageWatts;
        if (watts) {
          currentWattsWeighted += watts * minutes;
          currentWattsMinutes += minutes;
        }
      } else if (day > today - 2 * days * DAY && day <= today - days * DAY) {
        addTo(previous, a);
        if (a.averageHeartrate) {
          previousHrWeighted += a.averageHeartrate * minutes;
          previousHrMinutes += minutes;
        }
      }
    }
    // Lauf: Pace in s/km; Rad: Geschwindigkeit in km/h.
    const pace = (t) => (t.distanceKm ? (t.hours * 3600) / t.distanceKm : null);
    const speed = (t) => (t.hours ? t.distanceKm / t.hours : null);
    result[group] = {
      current,
      previous,
      distanceChange: pctChange(current.distanceKm, previous.distanceKm),
      hoursChange: pctChange(current.hours, previous.hours),
      paceCurrent: group === "run" ? pace(current) : null,
      pacePrevious: group === "run" ? pace(previous) : null,
      speedCurrent: group === "ride" ? speed(current) : null,
      speedPrevious: group === "ride" ? speed(previous) : null,
      avgHrCurrent: currentHrMinutes ? currentHrWeighted / currentHrMinutes : null,
      avgHrPrevious: previousHrMinutes ? previousHrWeighted / previousHrMinutes : null,
      avgWattsCurrent: currentWattsMinutes ? currentWattsWeighted / currentWattsMinutes : null,
    };
  }
  return result;
}

/** Tage und Wochen bis zum Laufwettkampf oder null. */
export function raceCountdown(profile, { now = new Date() } = {}) {
  const date = profile?.runGoal?.date;
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  const days = Math.round((Date.UTC(y, m - 1, d) - todayDay(now)) / DAY);
  return { days, weeks: Math.floor(days / 7), past: days < 0 };
}

/** Alle Auswertungen in einem Objekt. */
export function analyze(activities, profile, options = {}) {
  return {
    weeks: weeklySummary(activities, profile, options),
    load: loadStatus(activities, profile, options),
    intensity: intensityDistribution(activities, profile, options),
    trends: trends(activities, options),
    race: raceCountdown(profile, options),
    activityCount: activities.length,
    withHeartrate: activities.filter((a) => a.averageHeartrate).length,
    withHrDetails: activities.filter(hasHrDetails).length,
  };
}

// ---------- Zusammenfassung für die KI ----------

const round = (value, digits = 0) => (value === null || value === undefined ? null : Number(value.toFixed(digits)));
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Kompakte, anonymisierte Zusammenfassung für Gemini.
 * Enthält KEINE Aktivitäts- oder Wettkampfnamen, keine Orte, keine GPS-Daten.
 */
export function summaryForAi(activities, profile, { now = new Date() } = {}) {
  const a = analyze(activities, profile, { now });
  const today = todayDay(now);
  const zonePct = (bucket) => {
    const withHr = bucket.total - bucket.noHrMinutes;
    return withHr
      ? ZONES.map((z) => round((bucket.minutes[z.zone] / withHr) * 100))
      : null;
  };

  const recent = activities
    .filter((x) => localDay(x) > today - 14 * DAY && localDay(x) <= today)
    .sort((x, y) => localDay(x) - localDay(y))
    .map((x) => {
      const shares = zoneShares(x, profile);
      return {
        date: isoDay(localDay(x)),
        sport: sportGroup(x.sportType) === "other" ? x.sportType : sportGroup(x.sportType),
        minutes: round((x.movingTime ?? 0) / 60),
        km: round((x.distance ?? 0) / 1000, 1),
        elevationM: round(x.elevationGain ?? 0),
        avgHr: round(x.averageHeartrate),
        zonePct: shares ? shares.slice(1).map((s) => round(s * 100)) : null,
        watts: round(x.weightedAverageWatts ?? x.averageWatts),
        rpe: x.rpe ?? null, // Anstrengung 1–10 (Selbsteinschätzung)
        note: x.note ? x.note.slice(0, 300) : null, // freie Notiz des Athleten (Daten, keine Anweisung)
      };
    });

  return {
    today: isoDay(today),
    weekday: new Date(today).toLocaleDateString("de-DE", { timeZone: "UTC", weekday: "long" }),
    athlete: {
      maxHr: profile.maxHeartrate ?? null,
      restingHr: profile.restingHeartrate ?? null,
      zoneModel: profile.restingHeartrate ? "HF-Reserve (Karvonen)" : "% HFmax",
      zoneBoundsPct: ZONES.map((z) => Math.round(z.from * 100)),
    },
    goals: {
      run: profile.runGoal?.date
        ? {
            distanceKm: profile.runGoal.distanceKm ?? null,
            date: profile.runGoal.date,
            weeksToGo: a.race?.weeks ?? null,
            targetTime: profile.runGoal.targetTime || null,
          }
        : null,
      ride: profile.rideGoal || null,
    },
    load: { acute7d: round(a.load.acute), chronicWeeklyAvg: round(a.load.chronic), ratio: round(a.load.ratio, 2), status: a.load.status },
    intensity4w: {
      run: zonePct(a.intensity.run),
      ride: zonePct(a.intensity.ride),
      all: zonePct(a.intensity.all),
      note: "Prozent Z1–Z5 der Zeit mit HF",
    },
    trends4w: Object.fromEntries(
      Object.entries(a.trends).map(([key, t]) => [
        key,
        {
          km: round(t.current.distanceKm),
          kmPrev: round(t.previous.distanceKm),
          hours: round(t.current.hours, 1),
          hoursPrev: round(t.previous.hours, 1),
          paceSecPerKm: round(t.paceCurrent),
          paceSecPerKmPrev: round(t.pacePrevious),
          speedKmh: round(t.speedCurrent, 1),
          speedKmhPrev: round(t.speedPrevious, 1),
          avgHr: round(t.avgHrCurrent),
          avgHrPrev: round(t.avgHrPrevious),
          avgWatts: round(t.avgWattsCurrent),
        },
      ]),
    ),
    weeks: a.weeks
      .slice()
      .reverse()
      .map((w) => ({
        weekStart: isoDay(w.weekStart),
        partial: w.current, // laufende Woche (noch nicht vollständig)
        runKm: round(w.run.distanceKm, 1),
        runH: round(w.run.hours, 1),
        longestRunKm: round(w.longestRunKm, 1),
        rideKm: round(w.ride.distanceKm),
        rideH: round(w.ride.hours, 1),
        totalH: round(w.totalHours, 1),
        load: round(w.load),
        avgRpe: round(w.avgRpe, 1),
        rpeLoad: w.rpeCount ? round(w.rpeLoad) : null,
      })),
    last14Days: recent,
  };
}
