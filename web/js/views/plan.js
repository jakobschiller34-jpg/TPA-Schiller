import { listActivities, listAnalyses, onUserChanged, setPlanCheck } from "../firebase.js";
import { ANALYSIS_MODES } from "../gemini.js";
import { disciplineStats, evaluatePlan, historyStats, STATUS_INFO } from "../plan-tracking.js";

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

const pct = (rate) => (rate === null ? "–" : `${Math.round(rate * 100)} %`);
const dayLabel = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("de-DE", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });

function rateLevel(rate) {
  if (rate === null) return "neutral";
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

  function showMessage(text, kind = "error") {
    message.textContent = text;
    message.className = `message ${kind}`;
    message.hidden = false;
  }

  async function setCheck(analysis, date, check) {
    try {
      analysis.checks = await setPlanCheck(analysis.id, date, check);
      renderPlan();
    } catch (error) {
      showMessage(`Speichern fehlgeschlagen: ${error.message}`);
    }
  }

  function renderPlan() {
    const current = analyses[0];
    if (!current?.recommendation?.nextSessions?.length) {
      content.replaceChildren(
        el("section", { className: "card" },
          el("p", { text: "Noch kein Plan vorhanden." }),
          el("p", { className: "muted", text: "Erstelle unter „Analyse“ eine Empfehlung – die 7 Tage daraus erscheinen hier zum Abhaken." })),
      );
      return;
    }

    const checks = current.checks ?? {};
    const days = evaluatePlan(current.recommendation, activities, checks);
    const stats = disciplineStats(days);
    const history = historyStats(analyses, activities);

    // ---------- Disziplin ----------
    const statTile = (heading, s, note) =>
      el("div", { className: "stat" },
        el("p", { className: "stat-label", text: heading }),
        el("p", { className: `stat-value ${rateLevel(s.rate)}`, text: pct(s.rate) }),
        el("p", { className: "muted", text: note }));
    const discipline = el("section", { className: "card" },
      el("h2", { text: "Disziplin" }),
      el("div", { className: "stats" },
        statTile("Aktueller Plan", stats,
          stats.countedDays
            ? `${stats.fullDays} von ${stats.countedDays} Tagen voll erfüllt · Extras ${stats.extrasDone}/${stats.extrasOffered}`
            : "Noch kein Tag vorbei"),
        statTile("Letzte 4 Wochen", history,
          history.countedDays
            ? `${history.fullDays} von ${history.countedDays} Tagen voll erfüllt · Extras ${history.extrasDone}/${history.extrasOffered}`
            : "Noch keine Daten")),
      el("p", { className: "muted", text: "Voll erfüllt = 1 Punkt, teilweise/anders trainiert = ½, verpasst/ausgelassen = 0. Heute und künftige Tage zählen noch nicht." }));

    // ---------- Plan-Tabelle ----------
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

      // Optionaler Zusatz mit Häkchen
      const extraCell = el("td", { className: "wrap optional" });
      if (s.optionalExtra) {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = d.extraDone;
        box.title = "Zusatz erledigt";
        box.addEventListener("change", () => setCheck(current, d.date, { ...checks[d.date], extra: box.checked }));
        const label = el("label", { className: "extra-check" }, box,
          ` + ${s.optionalExtra.title} (${s.optionalExtra.durationMin} min)`);
        extraCell.append(label);
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
    const planCard = el("section", { className: "card" },
      el("h2", { text: "Aktueller Plan" }),
      el("p", { className: "muted", text: `Erstellt ${when} · ${ANALYSIS_MODES[current.mode]?.label ?? "Analyse"} · ${current.model}` }),
      el("div", { className: "table-wrap" },
        el("table", { className: "table" },
          el("thead", {}, el("tr", {}, ...["Tag", "Plan", "Ist (Strava)", "Status", "Optional", "Abhaken"].map((t) => el("th", { text: t })))),
          el("tbody", {}, ...rows))),
      el("p", { className: "muted", text: "Automatisch abgehakt wird anhand der importierten Aktivitäten (Seite „Aktivitäten“ → importieren). Mit ✓/✗ überstimmst du die Automatik, ↺ setzt zurück." }));

    if (current.recommendation.extraBudget) {
      planCard.append(el("p", {},
        el("strong", { text: "Spielraum für Extras: " }),
        `bis zu ${current.recommendation.extraBudget.maxExtraHours} h – ${current.recommendation.extraBudget.guidance}`));
    }

    content.replaceChildren(discipline, planCard);
  }

  async function load() {
    try {
      [analyses, activities] = await Promise.all([listAnalyses({ max: 20 }), listActivities({ max: 1000 })]);
      renderPlan();
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
