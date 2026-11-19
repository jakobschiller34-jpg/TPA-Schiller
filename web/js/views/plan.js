import { summaryForAi } from "../analysis.js";
import {
  getProfile,
  latestSeasonPlan,
  listActivities,
  listAnalyses,
  onUserChanged,
  saveSeasonPlan,
  setPlanCheck,
} from "../firebase.js";
import { ANALYSIS_MODES, getSeasonPlan } from "../gemini.js";
import { disciplineStats, evaluatePlan, historyStats, STATUS_INFO } from "../plan-tracking.js";
import { evaluateSeason, seasonStats, seasonWeekStarts } from "../season.js";

const SPORT_SHORT = { Run: "Lauf", TrailRun: "Traillauf", Ride: "Rad", VirtualRide: "Rad (virtuell)", GravelRide: "Gravel", MountainBikeRide: "MTB", Walk: "Gehen", Hike: "Wandern", WeightTraining: "Kraft", Workout: "Training", Yoga: "Yoga" };

/** Element mit Text (immer textContent, nie HTML). */
function el(tag, { className, text, title } = {}, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (title) node.title = title;
  node.append(...children);
  return node;
}

function smallButton(text, title, onClick, { pressed = false } = {}) {
  const b = el("button", { className: "button button-secondary button-small", text, title });
  b.type = "button";
  b.setAttribute("aria-pressed", String(pressed));
  b.addEventListener("click", onClick);
  return b;
}

function table(headers, rows) {
  return el("div", { className: "table-wrap" },
    el("table", { className: "table" },
      el("thead", {}, el("tr", {}, ...headers.map(([text, cls]) => el("th", { text, className: cls })))),
      el("tbody", {}, ...rows)));
}

const pct = (rate) => (rate === null || rate === undefined ? "–" : `${Math.round(rate * 100)} %`);
const num = (v, digits = 0) => (v === null || v === undefined ? "–" : v.toLocaleString("de-DE", { maximumFractionDigits: digits }));
const dayLabel = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("de-DE", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });
const shortDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("de-DE", { timeZone: "UTC", day: "2-digit", month: "2-digit" });

function rateLevel(rate) {
  if (rate === null || rate === undefined) return "neutral";
  if (rate >= 0.85) return "ok";
  if (rate >= 0.6) return "warn";
  return "high";
}

export function render(container) {
  container.innerHTML = `
    <h1>Trainingsplan</h1>
    <p id="plan-message" class="message" role="status" hidden></p>
    <div id="plan-content"><p class="muted">Lade Plan …</p></div>`;

  const message = container.querySelector("#plan-message");
  const content = container.querySelector("#plan-content");
  let analyses = [];
  let activities = [];
  let profile = {};
  let season = null;
  let seasonBusy = null; // Modus, der gerade läuft
  let seasonStatus = "";
  let seasonError = "";

  function showMessage(text, kind = "error") {
    message.textContent = text;
    message.className = `message ${kind}`;
    message.hidden = false;
  }

  async function setCheck(analysis, date, check) {
    try {
      analysis.checks = await setPlanCheck(analysis.id, date, check);
      renderPage();
    } catch (error) {
      showMessage(`Speichern fehlgeschlagen: ${error.message}`);
    }
  }

  // ---------- Saisonplan erstellen ----------

  async function createSeasonPlan(mode) {
    const raceDate = profile.runGoal?.date;
    const weekStarts = seasonWeekStarts(raceDate);
    if (season && !confirm("Neuen Saisonplan erstellen? Der bisherige wird ersetzt (bleibt aber gespeichert).")) return;
    seasonBusy = mode;
    seasonError = "";
    seasonStatus = "";
    renderPage();
    try {
      const summary = summaryForAi(activities, profile);
      const { plan, model } = await getSeasonPlan(summary, weekStarts, {
        mode,
        onStatus: (text) => {
          seasonStatus = text;
          renderPage();
        },
      });
      const id = await saveSeasonPlan({ model, mode, raceDate, plan });
      season = { id, model, mode, raceDate, plan, createdAtMs: Date.now() };
    } catch (error) {
      seasonError = error.message;
    } finally {
      seasonBusy = null;
      seasonStatus = "";
      renderPage();
    }
  }

  function seasonButtons() {
    return el("div", { className: "button-row" },
      ...Object.entries(ANALYSIS_MODES).map(([mode, cfg]) => {
        const b = el("button", {
          className: mode === "thorough" ? "button" : "button button-secondary",
          text: seasonBusy === mode ? "Gemini plant …" : `${season ? "Neu planen" : "Saisonplan erstellen"}: ${cfg.label.replace(" Analyse", "")} (${cfg.hint})`,
        });
        b.type = "button";
        b.disabled = Boolean(seasonBusy);
        b.addEventListener("click", () => createSeasonPlan(mode));
        return b;
      }));
  }

  function renderSeasonCard(evaluated) {
    const card = el("section", { className: "card" }, el("h2", { text: "Saisonplan bis zum Wettkampf" }));
    const raceDate = profile.runGoal?.date;
    const weekStarts = seasonWeekStarts(raceDate);

    if (!raceDate || !weekStarts.length) {
      card.append(el("p", { className: "muted", text: "Trage unter „Analyse“ → „Profil & Ziele“ einen Laufwettkampf mit Datum in der Zukunft ein, dann kann Gemini einen Saisonplan erstellen." }));
      return card;
    }

    if (!season) {
      card.append(el("p", { text: `${weekStarts.length} Wochen bis zum Wettkampf am ${shortDate(raceDate)}. Gemini plant Phasen und Wochenziele (Lauf-km, langer Lauf, Rad-Stunden, Schlüsseleinheiten). Die 7-Tage-Empfehlung richtet sich danach.` }));
    }
    card.append(seasonButtons());
    if (seasonBusy && seasonStatus) card.append(el("p", { className: "muted", text: seasonStatus }));
    if (seasonError) card.append(el("p", { className: "message error", text: seasonError }));
    if (!season) return card;

    const plan = season.plan;
    const when = season.createdAtMs ? new Date(season.createdAtMs).toLocaleString("de-DE") : "";
    card.append(el("p", { className: "muted", text: `Erstellt ${when} · ${ANALYSIS_MODES[season.mode]?.label ?? "Analyse"} · ${season.model} · ${plan.weeks.length} Wochen bis ${shortDate(season.raceDate)}` }));
    if (season.raceDate !== raceDate) {
      card.append(el("p", { className: "message error", text: "Das Wettkampfdatum im Profil hat sich geändert – bitte neu planen." }));
    }
    card.append(el("p", { text: plan.overview }));
    card.append(el("ul", {}, ...plan.phases.map((ph) =>
      el("li", {}, el("strong", { text: `${ph.name} (Woche ${ph.fromWeek}${ph.toWeek !== ph.fromWeek ? `–${ph.toWeek}` : ""}): ` }), ph.goal))));

    const sollIst = (soll, ist, digits = 0) => `${num(soll, digits)} / ${num(ist, digits)}`;
    const rows = evaluated.map((w, i) => {
      const fulfil = w.state === "future" ? "" : pct(w.fulfilment);
      return el("tr", { className: w.state === "current" ? "is-today" : "" },
        el("td", {}, el("strong", { text: `${i + 1}` }), el("div", { className: "muted small", text: shortDate(w.weekStart) })),
        el("td", {}, w.phase, w.recoveryWeek ? el("div", { className: "muted small", text: "Entlastung" }) : ""),
        el("td", { className: "wrap", text: w.focus }),
        el("td", { className: "num", text: w.state === "future" ? num(w.runKm) : sollIst(w.runKm, w.actual.runKm) }),
        el("td", { className: "num", text: w.state === "future" ? num(w.longRunKm) : sollIst(w.longRunKm, w.actual.longRunKm) }),
        el("td", { className: "num", text: w.state === "future" ? num(w.rideHours, 1) : sollIst(w.rideHours, w.actual.rideHours, 1) }),
        el("td", { className: "wrap" }, el("ul", { className: "compact" }, ...w.keySessions.map((k) => el("li", { text: k })))),
        // laufende Woche neutral anzeigen – sie ist noch nicht abgeschlossen
        el("td", { className: "num" }, fulfil ? el("span", { className: `badge ${w.state === "current" ? "neutral" : rateLevel(w.fulfilment)}`, text: w.state === "current" ? `bisher ${fulfil}` : fulfil }) : ""));
    });
    const seasonTable = table([["Woche"], ["Phase"], ["Fokus"], ["Lauf km", "num"], ["Lang", "num"], ["Rad h", "num"], ["Schlüsseleinheiten"], ["Erfüllung", "num"]], rows);
    seasonTable.classList.add("season-table");
    card.append(
      seasonTable,
      el("p", { className: "muted", text: "Vergangene/laufende Wochen: Soll / Ist. „Lang“ = längster Lauf (km). Erfüllung = Ø aus Lauf-km, langem Lauf und Rad-Stunden (je max. 100 %)." }),
      el("p", {}, el("strong", { text: "Wettkampf: " }), plan.raceStrategy));
    return card;
  }

  // ---------- Wochenplan (7 Tage aus der Empfehlung) ----------

  function renderWeekCard(current, days) {
    const checks = current.checks ?? {};
    const rows = days.map((d) => {
      const s = d.session;
      const info = STATUS_INFO[d.status];
      const planCell = el("td", { className: "wrap" },
        el("strong", { text: s.sport === "Ruhetag" ? "Ruhetag" : `${s.sport}: ${s.title}` }),
        el("div", { className: "muted", text: s.sport === "Ruhetag" ? s.description : `${s.durationMin} min · ${s.intensity} · ${s.description}` }));
      const actualText = d.actual.length
        ? d.actual.map((a) => `${SPORT_SHORT[a.sportType] ?? a.sportType} ${Math.round((a.movingTime ?? 0) / 60)} min`).join(", ")
        : "–";
      const statusCell = el("td", {},
        el("span", { className: `badge ${info.level}`, text: `${info.icon} ${info.label}` }),
        d.manual ? el("div", { className: "muted small", text: "manuell" }) : "");

      const extraCell = el("td", { className: "wrap optional" });
      if (s.optionalExtra) {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = d.extraDone;
        box.title = "Zusatz erledigt";
        box.addEventListener("change", () => setCheck(current, d.date, { ...checks[d.date], extra: box.checked }));
        extraCell.append(el("label", { className: "extra-check" }, box, ` + ${s.optionalExtra.title} (${s.optionalExtra.durationMin} min)`));
      } else {
        extraCell.textContent = "–";
      }

      const actions = el("td", {},
        el("div", { className: "button-row nowrap plan-actions" },
          smallButton("✓", "Als erledigt abhaken", () => setCheck(current, d.date, { ...checks[d.date], status: "done" }), { pressed: d.manual === "done" }),
          smallButton("✗", "Als ausgelassen markieren", () => setCheck(current, d.date, { ...checks[d.date], status: "skipped" }), { pressed: d.manual === "skipped" }),
          smallButton("↺", "Zurück zur Automatik", () => setCheck(current, d.date, { status: null, extra: null }))));

      return el("tr", { className: d.status === "today" ? "is-today" : "" },
        el("td", { text: dayLabel(d.date) }), planCell, el("td", { text: actualText }), statusCell, extraCell, actions);
    });

    const when = current.createdAtMs ? new Date(current.createdAtMs).toLocaleString("de-DE") : "";
    const card = el("section", { className: "card" },
      el("h2", { text: "Diese Woche (7-Tage-Plan)" }),
      el("p", { className: "muted", text: `Erstellt ${when} · ${ANALYSIS_MODES[current.mode]?.label ?? "Analyse"} · ${current.model}` }),
      table([["Tag"], ["Plan"], ["Ist (Strava)"], ["Status"], ["Optional"], ["Abhaken"]], rows),
      el("p", { className: "muted", text: "Automatisch abgehakt wird anhand der importierten Aktivitäten (Seite „Aktivitäten“ → importieren). Mit ✓/✗ überstimmst du die Automatik, ↺ setzt zurück." }));
    if (current.recommendation.extraBudget) {
      card.append(el("p", {},
        el("strong", { text: "Spielraum für Extras: " }),
        `bis zu ${current.recommendation.extraBudget.maxExtraHours} h – ${current.recommendation.extraBudget.guidance}`));
    }
    return card;
  }

  // ---------- Seite ----------

  function renderPage() {
    const current = analyses[0]?.recommendation?.nextSessions?.length ? analyses[0] : null;
    const days = current ? evaluatePlan(current.recommendation, activities, current.checks ?? {}) : [];
    const weekStats = disciplineStats(days);
    const history = historyStats(analyses, activities);
    const evaluatedSeason = season ? evaluateSeason(season.plan, activities) : [];
    const seasonRate = seasonStats(evaluatedSeason);

    const statTile = (heading, rate, note) =>
      el("div", { className: "stat" },
        el("p", { className: "stat-label", text: heading }),
        el("p", { className: `stat-value ${rateLevel(rate)}`, text: pct(rate) }),
        el("p", { className: "muted", text: note }));
    const dayNote = (s, empty) =>
      s.countedDays ? `${s.fullDays} von ${s.countedDays} Tagen voll erfüllt · Extras ${s.extrasDone}/${s.extrasOffered}` : empty;

    const discipline = el("section", { className: "card" },
      el("h2", { text: "Disziplin" }),
      el("div", { className: "stats" },
        statTile("Diese Woche", weekStats.rate, dayNote(weekStats, current ? "Noch kein Tag vorbei" : "Noch kein 7-Tage-Plan")),
        statTile("Letzte 4 Wochen", history.rate, dayNote(history, "Noch keine Daten")),
        statTile("Saison", seasonRate.rate, season ? (seasonRate.weeks ? `${seasonRate.weeks} abgeschlossene Wochen, Ø Erfüllung der Wochenziele` : "Noch keine Woche abgeschlossen") : "Noch kein Saisonplan")),
      el("p", { className: "muted", text: "Tage: voll erfüllt = 1, teilweise/anders trainiert = ½, verpasst/ausgelassen = 0; heute und künftige Tage zählen noch nicht. Saison: Ø Erfüllung der Wochenziele." }));

    const weekCard = current
      ? renderWeekCard(current, days)
      : el("section", { className: "card" },
          el("h2", { text: "Diese Woche (7-Tage-Plan)" }),
          el("p", { className: "muted", text: "Erstelle unter „Analyse“ eine Empfehlung – die 7 Tage daraus erscheinen hier zum Abhaken." }));

    content.replaceChildren(discipline, weekCard, renderSeasonCard(evaluatedSeason));
  }

  async function load() {
    try {
      [analyses, activities, profile, season] = await Promise.all([
        listAnalyses({ max: 20 }),
        listActivities({ max: 1000 }),
        getProfile(),
        latestSeasonPlan(),
      ]);
      renderPage();
    } catch (error) {
      content.replaceChildren();
      showMessage(`Plan konnte nicht geladen werden: ${error.message}`);
    }
  }

  let unsubscribe = null;
  let loaded = false;
  unsubscribe = onUserChanged((user) => {
    if (!container.contains(content)) {
      unsubscribe?.();
      return;
    }
    if (!user) {
      content.replaceChildren(el("p", { className: "muted", text: "Bitte zuerst anmelden." }));
      return;
    }
    if (!loaded) {
      loaded = true;
      load();
    }
  });
}
