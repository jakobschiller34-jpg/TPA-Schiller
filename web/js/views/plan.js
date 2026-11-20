import { summaryForAi } from "../analysis.js";
import {
  getProfile,
  latestSeasonPlan,
  listActivities,
  listAnalyses,
  onUserChanged,
  saveAnalysis,
  saveSeasonPlan,
  setPlanCheck,
} from "../firebase.js";
import { ANALYSIS_MODES, getRecommendation, getSeasonPlan } from "../gemini.js";
import { athleticsDays, disciplineStats, evaluatePlan, historyStats, STATUS_INFO } from "../plan-tracking.js";
import { currentSeasonContext, evaluateSeason, seasonStats, seasonWeekStarts } from "../season.js";

const SPORT_SHORT = { Run: "Lauf", TrailRun: "Traillauf", Ride: "Rad", VirtualRide: "Rad (virtuell)", GravelRide: "Gravel", MountainBikeRide: "MTB", Walk: "Gehen", Hike: "Wandern", WeightTraining: "Kraft", Workout: "Training", Yoga: "Yoga" };

/** Element mit Text (immer textContent, nie HTML). */
function el(tag, { className, text, title, ...attrs } = {}, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (title) node.title = title;
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
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
  let dayBusy = null; // Modus der laufenden Tagesplan-Erstellung
  let dayStatus = "";
  let dayError = "";
  let waitStartedMs = 0;

  // Wartezeit sichtbar hochzählen (für beide Gemini-Aufrufe)
  const waitTimer = setInterval(() => {
    if (!container.isConnected) {
      clearInterval(waitTimer);
      return;
    }
    const statusEl = container.querySelector(".gemini-status");
    if (statusEl && waitStartedMs) {
      statusEl.textContent = `${statusEl.dataset.text} ${Math.round((Date.now() - waitStartedMs) / 1000)} s`;
    }
  }, 1000);

  function statusLine(text) {
    const p = el("p", { className: "muted gemini-status", text });
    p.dataset.text = text;
    return p;
  }

  // ---------- Tagesplan (7 Tage) erstellen ----------

  async function createDayPlan(mode) {
    dayBusy = mode;
    dayError = "";
    dayStatus = "Erstelle Tagesplan …";
    renderPage();
    try {
      const seasonContext = currentSeasonContext(season?.plan, new Date(), athleticsDays(analyses, activities));
      const summary = summaryForAi(activities, profile, { seasonContext });
      const { recommendation, model } = await getRecommendation(summary, {
        mode,
        onStatus: (text, info) => {
          dayStatus = text;
          if (info?.waitingFor) waitStartedMs = Date.now();
          renderPage();
        },
      });
      const id = await saveAnalysis({ model, mode, summary, recommendation });
      analyses.unshift({ id, model, mode, summary, recommendation, checks: {}, createdAtMs: Date.now() });
    } catch (error) {
      dayError = error.message;
    } finally {
      dayBusy = null;
      dayStatus = "";
      waitStartedMs = 0;
      renderPage();
    }
  }

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
        onStatus: (text, info) => {
          seasonStatus = text;
          if (info?.waitingFor) waitStartedMs = Date.now();
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
      waitStartedMs = 0;
      renderPage();
    }
    // Ein Plan aus einem Guss: nach dem Saisonplan direkt die Tage dieser Woche planen.
    if (!seasonError && season) await createDayPlan("quick");
  }

  function seasonButtons() {
    return el("div", { className: "button-row" },
      ...Object.entries(ANALYSIS_MODES).map(([mode, cfg]) => {
        const b = el("button", {
          className: mode === "thorough" ? "button" : "button button-secondary",
          text: seasonBusy === mode ? "Gemini plant …" : `${season ? "Neu planen" : "Saisonplan erstellen"}: ${cfg.label.replace(" Analyse", "")} (${cfg.hint})`,
        });
        b.type = "button";
        b.disabled = Boolean(seasonBusy || dayBusy);
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
      card.append(el("p", { text: `${weekStarts.length} Wochen bis zum Wettkampf am ${shortDate(raceDate)}. Gemini plant Phasen und Wochenziele (Lauf-km, langer Lauf, Rad-Stunden, Kraft- und Dehneinheiten, Schlüsseleinheiten). Die 7-Tage-Empfehlung richtet sich danach.` }));
    }
    card.append(seasonButtons());
    if (seasonBusy && seasonStatus) card.append(statusLine(seasonStatus));
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

    // Einheitlich mit „Diese Woche“: Ist / Soll
    const sollIst = (soll, ist, digits = 0) => `${num(ist, digits)} / ${num(soll, digits)}`;
    const rows = evaluated.map((w, i) => {
      const fulfil = w.state === "future" ? "" : pct(w.fulfilment);
      return el("tr", { className: w.state === "current" ? "is-today" : "" },
        el("td", {}, el("strong", { text: `${i + 1}` }), el("div", { className: "muted small", text: shortDate(w.weekStart) })),
        el("td", {}, w.phase, w.recoveryWeek ? el("div", { className: "muted small", text: "Entlastung" }) : ""),
        el("td", { className: "wrap", text: w.focus }),
        el("td", { className: "num", text: w.state === "future" ? num(w.runKm) : sollIst(w.runKm, w.actual.runKm) }),
        el("td", { className: "num", text: w.state === "future" ? num(w.longRunKm) : sollIst(w.longRunKm, w.actual.longRunKm) }),
        el("td", { className: "num", text: w.state === "future" ? num(w.rideHours, 1) : sollIst(w.rideHours, w.actual.rideHours, 1) }),
        el("td", { className: "num", text: w.state === "future" ? num(w.strengthSessions) : sollIst(w.strengthSessions, w.actual.strengthSessions) }),
        el("td", { className: "num", text: w.state === "future" ? num(w.mobilitySessions) : sollIst(w.mobilitySessions, w.actual.mobilitySessions) }),
        el("td", { className: "wrap" }, el("ul", { className: "compact" }, ...w.keySessions.map((k) => el("li", { text: k })))),
        // laufende Woche neutral anzeigen – sie ist noch nicht abgeschlossen
        el("td", { className: "num" }, fulfil ? el("span", { className: `badge ${w.state === "current" ? "neutral" : rateLevel(w.fulfilment)}`, text: w.state === "current" ? `bisher ${fulfil}` : fulfil }) : ""));
    });
    const seasonTable = table([["Woche"], ["Phase"], ["Fokus"], ["Lauf km", "num"], ["Lang", "num"], ["Rad h", "num"], ["Kraft", "num"], ["Dehnen", "num"], ["Schlüsseleinheiten"], ["Erfüllung", "num"]], rows);
    seasonTable.classList.add("season-table");
    card.append(
      seasonTable,
      el("p", { className: "muted", text: "Vergangene/laufende Wochen: Ist / Soll. „Lang“ = längster Lauf (km). Kraft/Dehnen = Anzahl Tage mit erledigter Einheit (abgehakt oder bei Strava). Erfüllung = Ø aus allen Wochenzielen (je max. 100 %)." }),
      el("p", {}, el("strong", { text: "Wettkampf: " }), plan.raceStrategy));
    return card;
  }

  // ---------- Diese Woche: Wochenziele + Tagesplan ----------

  const expanded = new Set(); // aufgeklappte Tage (ISO-Datum), bleibt beim Neuzeichnen erhalten

  function dayPlanButtons(hasPlan) {
    return el("div", { className: "button-row" },
      ...Object.entries(ANALYSIS_MODES).map(([mode, cfg]) => {
        const b = el("button", {
          className: mode === "quick" ? "button" : "button button-secondary",
          text: dayBusy === mode ? "Gemini plant …" : `${hasPlan ? "Tagesplan aktualisieren" : "Tagesplan erstellen"}: ${cfg.label.replace(" Analyse", "")} (${cfg.hint})`,
        });
        b.type = "button";
        b.disabled = Boolean(seasonBusy || dayBusy);
        b.addEventListener("click", () => createDayPlan(mode));
        return b;
      }));
  }

  function renderWeekCard(current, days, ctx) {
    const card = el("section", { className: "card" }, el("h2", { text: "Diese Woche" }));
    if (!ctx && season) card.append(el("p", { className: "muted", text: "Die aktuelle Woche liegt außerhalb des Saisonplans." }));
    else if (!ctx) card.append(el("p", { className: "muted", text: "Ohne Saisonplan plant Gemini die Tage nur anhand deiner bisherigen Daten. Erstelle unten einen Saisonplan für Wochenziele bis zum Wettkampf." }));

    // Hinweise: abgelaufen oder älter als der aktuelle Saisonplan
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const lastDay = current?.recommendation.nextSessions.at(-1)?.date;
    if (current && lastDay && lastDay < today) {
      card.append(el("p", { className: "message error", text: "Der Tagesplan ist abgelaufen – bitte aktualisieren." }));
    } else if (current && season && (current.createdAtMs ?? 0) < (season.createdAtMs ?? 0)) {
      card.append(el("p", { className: "message", text: "Der Tagesplan ist älter als der Saisonplan – aktualisiere ihn, damit er zu den neuen Wochenzielen passt." }));
    }

    card.append(dayPlanButtons(Boolean(current)));
    if (dayBusy && dayStatus) card.append(statusLine(dayStatus));
    if (dayError) card.append(el("p", { className: "message error", text: dayError }));
    if (!current) return card;

    const checks = current.checks ?? {};
    const COLUMNS = 6;

    /** Schritt-für-Schritt-Anleitung als nummerierte Liste. */
    const stepsBlock = (heading, meta, steps, fallback) =>
      el("div", { className: "detail-block" },
        el("p", { className: "detail-heading" }, el("strong", { text: heading }), meta ? el("span", { className: "muted", text: ` · ${meta}` }) : ""),
        steps?.length
          ? el("ol", { className: "steps" }, ...steps.map((st) => el("li", {}, el("strong", { text: st.title }), el("span", { text: ` – ${st.detail}` }))))
          : el("p", { className: "muted", text: fallback }));

    const checkbox = (checked, title, onChange) => {
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = checked;
      box.title = title;
      box.addEventListener("change", () => onChange(box.checked));
      return box;
    };

    const rows = days.flatMap((d) => {
      const s = d.session;
      const info = STATUS_INFO[d.status];
      const open = expanded.has(d.date);
      const hasDetails = Boolean(s.steps?.length || s.supplement?.steps?.length || s.optionalExtra?.steps?.length);

      const planCell = el("td", { className: "wrap" },
        el("span", { className: "chevron", text: open ? "▾" : "▸", "aria-hidden": "true" }),
        el("strong", { text: s.sport === "Ruhetag" ? "Ruhetag" : `${s.sport}: ${s.title}` }),
        el("div", { className: "muted", text: s.sport === "Ruhetag" ? s.description : `${s.durationMin} min · ${s.intensity} · ${s.description}` }),
        s.supplement ? el("div", { className: "supplement-line", text: `+ ${s.supplement.kind}: ${s.supplement.title} (${s.supplement.durationMin} min)` }) : "");
      const actualText = d.actual.length
        ? d.actual.map((a) => `${SPORT_SHORT[a.sportType] ?? a.sportType} ${Math.round((a.movingTime ?? 0) / 60)} min`).join(", ")
        : "–";
      const statusCell = el("td", {},
        el("span", { className: `badge ${info.level}`, text: `${info.icon} ${info.label}` }),
        d.manual ? el("div", { className: "muted small", text: "manuell" }) : "");

      // Zusätze: fester Kraft-/Dehnblock (gehört zum Plan) + freiwilliger Zusatz
      const extrasCell = el("td", { className: "wrap optional" });
      if (s.supplement) {
        extrasCell.append(el("label", { className: "extra-check supplement" },
          checkbox(d.supplementDone, "Kraft-/Dehnblock erledigt", (v) => setCheck(current, d.date, { ...checks[d.date], supplement: v })),
          ` ${s.supplement.kind} (${s.supplement.durationMin} min)`));
      }
      if (s.optionalExtra) {
        extrasCell.append(el("label", { className: "extra-check" },
          checkbox(d.extraDone, "Optionalen Zusatz erledigt", (v) => setCheck(current, d.date, { ...checks[d.date], extra: v })),
          ` optional: ${s.optionalExtra.title} (${s.optionalExtra.durationMin} min)`));
      }
      if (!s.supplement && !s.optionalExtra) extrasCell.textContent = "–";

      const actions = el("td", {},
        el("div", { className: "button-row nowrap plan-actions" },
          smallButton("✓", "Als erledigt abhaken", () => setCheck(current, d.date, { ...checks[d.date], status: "done" }), { pressed: d.manual === "done" }),
          smallButton("✗", "Als ausgelassen markieren", () => setCheck(current, d.date, { ...checks[d.date], status: "skipped" }), { pressed: d.manual === "skipped" }),
          smallButton("↺", "Zurück zur Automatik", () => setCheck(current, d.date, { status: null, extra: null, supplement: null }))));

      const row = el("tr", { className: `session-row${d.status === "today" ? " is-today" : ""}${open ? " is-open" : ""}` },
        el("td", { text: dayLabel(d.date) }), planCell, el("td", { text: actualText }), statusCell, extrasCell, actions);
      row.tabIndex = 0;
      row.setAttribute("aria-expanded", String(open));
      row.title = "Klicken für die Detailanleitung";
      const toggle = () => {
        if (open) expanded.delete(d.date);
        else expanded.add(d.date);
        renderPage();
      };
      row.addEventListener("click", (event) => {
        if (event.target.closest("button, input, label, a")) return; // Abhaken nicht als Aufklappen werten
        toggle();
      });
      row.addEventListener("keydown", (event) => {
        if ((event.key === "Enter" || event.key === " ") && event.target === row) {
          event.preventDefault();
          toggle();
        }
      });
      if (!open) return [row];

      const blocks = [];
      if (s.sport === "Ruhetag") {
        blocks.push(stepsBlock("Ruhetag", null, s.steps, s.description || "Erholung – keine Einheit geplant."));
      } else {
        blocks.push(stepsBlock(`${s.sport}: ${s.title}`, `${s.durationMin} min · ${s.intensity}`, s.steps, s.description));
      }
      if (s.supplement) {
        blocks.push(stepsBlock(`${s.supplement.kind}: ${s.supplement.title}`, `${s.supplement.durationMin} min · gehört zum Plan`, s.supplement.steps, "Keine Detailanleitung vorhanden."));
      }
      if (s.optionalExtra) {
        blocks.push(stepsBlock(`Optional: ${s.optionalExtra.title}`, `${s.optionalExtra.durationMin} min · nur wenn du dich gut fühlst`, s.optionalExtra.steps, s.optionalExtra.description));
      }
      if (!hasDetails) {
        blocks.push(el("p", { className: "muted", text: "Für diesen Tagesplan gibt es noch keine Schritt-für-Schritt-Anleitung. Aktualisiere den Tagesplan, um sie zu bekommen." }));
      }
      const cell = el("td", {}, el("div", { className: "detail-grid" }, ...blocks));
      cell.colSpan = COLUMNS;
      return [row, el("tr", { className: "detail-row" }, cell)];
    });

    const when = current.createdAtMs ? new Date(current.createdAtMs).toLocaleString("de-DE") : "";
    card.append(
      el("h3", { text: "Tagesplan" }),
      el("p", { className: "muted", text: `Erstellt ${when} · ${ANALYSIS_MODES[current.mode]?.label ?? "Analyse"} · ${current.model} · Tipp: Auf eine Einheit klicken für die Detailanleitung.` }),
      table([["Tag"], ["Plan"], ["Ist (Strava)"], ["Status"], ["Zusätze"], ["Abhaken"]], rows),
      el("p", { className: "muted", text: "Automatisch abgehakt wird anhand der importierten Aktivitäten (Seite „Aktivitäten“ → importieren). Kraft und Dehnen landen oft nicht bei Strava – dann einfach selbst abhaken. Mit ✓/✗ überstimmst du die Automatik, ↺ setzt zurück." }));
    if (current.recommendation.extraBudget) {
      card.append(el("p", {},
        el("strong", { text: "Spielraum für Extras: " }),
        `bis zu ${num(current.recommendation.extraBudget.maxExtraHours, 1)} h – ${current.recommendation.extraBudget.guidance}`));
    }
    return card;
  }

  // ---------- Seite ----------

  function renderPage() {
    const current = analyses[0]?.recommendation?.nextSessions?.length ? analyses[0] : null;
    const days = current ? evaluatePlan(current.recommendation, activities, current.checks ?? {}) : [];
    const weekStats = disciplineStats(days);
    const history = historyStats(analyses, activities);
    const athletics = athleticsDays(analyses, activities);
    const evaluatedSeason = season ? evaluateSeason(season.plan, activities, new Date(), athletics) : [];
    const seasonRate = seasonStats(evaluatedSeason);

    const statTile = (heading, rate, note) =>
      el("div", { className: "stat" },
        el("p", { className: "stat-label", text: heading }),
        el("p", { className: `stat-value ${rateLevel(rate)}`, text: pct(rate) }),
        el("p", { className: "muted", text: note }));
    const dayNote = (s, empty) =>
      s.countedDays
        ? `${s.fullDays} von ${s.countedDays} Tagen voll erfüllt · Kraft/Dehnen ${s.supplementsDone}/${s.supplementsOffered} · Extras ${s.extrasDone}/${s.extrasOffered}`
        : empty;

    const discipline = el("section", { className: "card" },
      el("h2", { text: "Disziplin" }),
      el("div", { className: "stats" },
        statTile("Diese Woche", weekStats.rate, dayNote(weekStats, current ? "Noch kein Tag vorbei" : "Noch kein Tagesplan")),
        statTile("Letzte 4 Wochen", history.rate, dayNote(history, "Noch keine Daten")),
        statTile("Saison", seasonRate.rate, season ? (seasonRate.weeks ? `${seasonRate.weeks} abgeschlossene Wochen, Ø Erfüllung der Wochenziele` : "Noch keine Woche abgeschlossen") : "Noch kein Saisonplan")),
      el("p", { className: "muted", text: "Tage: voll erfüllt = 1, teilweise/anders trainiert = ½, verpasst/ausgelassen = 0; heute und künftige Tage zählen noch nicht. Saison: Ø Erfüllung der Wochenziele." }));

    const weekCard = renderWeekCard(current, days, currentSeasonContext(season?.plan));

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
