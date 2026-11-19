import { analyze, SPORT_GROUPS, ZONES } from "../analysis.js";
import { getProfile, latestAnalysis, listActivities, onUserChanged, saveProfile } from "../firebase.js";
import { ANALYSIS_MODES } from "../gemini.js";

const MAX_ACTIVITIES = 1000;

// ---------- kleine DOM- und Format-Helfer ----------

/** Element mit Text (immer textContent, nie HTML). */
function el(tag, { className, text } = {}, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  node.append(...children);
  return node;
}

function table(headers, rows) {
  const thead = el("thead", {}, el("tr", {}, ...headers.map(([text, cls]) => el("th", { text, className: cls }))));
  const tbody = el(
    "tbody",
    {},
    ...rows.map((cells) => el("tr", {}, ...cells.map(([text, cls]) => el("td", { text, className: cls })))),
  );
  return el("div", { className: "table-wrap" }, el("table", { className: "table" }, thead, tbody));
}

const fmt = (value, digits = 0) =>
  value === null || value === undefined || Number.isNaN(value)
    ? "–"
    : value.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });

function fmtChange(pct) {
  if (pct === null) return "neu";
  if (pct === undefined || Number.isNaN(pct)) return "–";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${fmt(pct)} %`;
}

function fmtPace(secondsPerKm) {
  if (!secondsPerKm) return "–";
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")} /km`;
}

function fmtWeek(ms, current) {
  const d = new Date(ms);
  const label = d.toLocaleDateString("de-DE", { timeZone: "UTC", day: "2-digit", month: "2-digit" });
  return current ? `ab ${label} (laufend)` : `ab ${label}`;
}

const pct = (part, total) => (total ? (part / total) * 100 : 0);

// ---------- Profil-Formular ----------

function readNumber(input) {
  const value = Number(input.value);
  return input.value.trim() && Number.isFinite(value) ? value : null;
}

function validateProfile(p) {
  if (p.maxHeartrate !== null && (p.maxHeartrate < 120 || p.maxHeartrate > 230)) {
    return "Max-HF sollte zwischen 120 und 230 liegen.";
  }
  if (p.restingHeartrate !== null) {
    if (p.restingHeartrate < 30 || p.restingHeartrate > 100) return "Ruhepuls sollte zwischen 30 und 100 liegen.";
    if (p.maxHeartrate !== null && p.restingHeartrate >= p.maxHeartrate) return "Ruhepuls muss unter der Max-HF liegen.";
  }
  if (p.runGoal.targetTime && !/^\d{1,2}:\d{2}(:\d{2})?$/.test(p.runGoal.targetTime)) {
    return "Zielzeit bitte als h:mm:ss oder mm:ss angeben, z. B. 1:45:00.";
  }
  return null;
}

// ---------- Seite ----------

export function render(container) {
  container.innerHTML = `
    <h1>Analyse &amp; Empfehlungen</h1>
    <p id="ana-message" class="message" role="status" hidden></p>

    <details id="ana-profile" class="card">
      <summary><strong>Profil &amp; Ziele</strong></summary>
      <form id="ana-form" class="form">
        <div class="form-grid">
          <label>Maximale Herzfrequenz
            <input name="maxHeartrate" type="number" inputmode="numeric" min="120" max="230" placeholder="z. B. 190" />
            <span class="hint">Grundlage für die HF-Zonen. Am besten aus einem Leistungstest.</span>
          </label>
          <label>Ruhepuls (optional)
            <input name="restingHeartrate" type="number" inputmode="numeric" min="30" max="100" placeholder="z. B. 50" />
            <span class="hint">Mit Ruhepuls werden die Zonen nach HF-Reserve (Karvonen) berechnet.</span>
          </label>
        </div>
        <h3>Laufen – Wettkampf</h3>
        <div class="form-grid">
          <label>Wettkampf
            <input name="runName" type="text" maxlength="80" placeholder="z. B. Halbmarathon Frankfurt" />
          </label>
          <label>Datum
            <input name="runDate" type="date" />
          </label>
          <label>Distanz (km)
            <input name="runDistance" type="number" step="0.1" min="1" max="200" placeholder="21.1" />
          </label>
          <label>Zielzeit (optional)
            <input name="runTargetTime" type="text" placeholder="1:45:00" />
          </label>
        </div>
        <h3>Radfahren</h3>
        <label>Ziel
          <input name="rideGoal" type="text" maxlength="200" />
        </label>
        <div class="button-row">
          <button class="button" type="submit">Profil speichern</button>
        </div>
      </form>
    </details>

    <div id="ana-results"><p class="muted">Lade Daten …</p></div>`;

  const message = container.querySelector("#ana-message");
  const details = container.querySelector("#ana-profile");
  const form = container.querySelector("#ana-form");
  const results = container.querySelector("#ana-results");

  let activities = [];
  let profile = {};

  function showMessage(text, kind = "ok") {
    message.textContent = text;
    message.className = `message ${kind}`;
    message.hidden = false;
  }

  function fillForm() {
    form.maxHeartrate.value = profile.maxHeartrate ?? "";
    form.restingHeartrate.value = profile.restingHeartrate ?? "";
    form.runName.value = profile.runGoal?.name ?? "";
    form.runDate.value = profile.runGoal?.date ?? "";
    form.runDistance.value = profile.runGoal?.distanceKm ?? "";
    form.runTargetTime.value = profile.runGoal?.targetTime ?? "";
    form.rideGoal.value = profile.rideGoal ?? "Allgemeine Leistungssteigerung";
    details.open = !profile.maxHeartrate; // beim ersten Mal aufgeklappt
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const next = {
      maxHeartrate: readNumber(form.maxHeartrate),
      restingHeartrate: readNumber(form.restingHeartrate),
      runGoal: {
        name: form.runName.value.trim(),
        date: form.runDate.value || null,
        distanceKm: readNumber(form.runDistance),
        targetTime: form.runTargetTime.value.trim(),
      },
      rideGoal: form.rideGoal.value.trim(),
    };
    const error = validateProfile(next);
    if (error) {
      showMessage(error, "error");
      return;
    }
    try {
      await saveProfile(next);
      profile = next;
      showMessage("Profil gespeichert.");
      renderResults();
    } catch (err) {
      showMessage(`Speichern fehlgeschlagen: ${err.message}`, "error");
    }
  });

  // ---------- Ergebnisse ----------

  function renderResults() {
    if (!activities.length) {
      results.replaceChildren(
        el("p", { className: "muted", text: "Noch keine Aktivitäten. Bitte zuerst unter „Aktivitäten“ importieren." }),
      );
      return;
    }
    const a = analyze(activities, profile);
    const cards = [];

    // Wettkampf-Countdown
    if (a.race) {
      const goal = profile.runGoal;
      const name = goal.name || "Laufwettkampf";
      const text = a.race.past
        ? `${name} war vor ${-a.race.days} Tagen.`
        : `${name} in ${a.race.weeks} Wochen (${a.race.days} Tage)` +
          (goal.distanceKm ? ` · ${fmt(goal.distanceKm, 1)} km` : "") +
          (goal.targetTime ? ` · Ziel ${goal.targetTime}` : "");
      cards.push(el("section", { className: "card highlight" }, el("h2", { text: "Wettkampf" }), el("p", { text })));
    }

    cards.push(renderGeminiCard());

    // Belastung
    cards.push(
      el(
        "section",
        { className: "card" },
        el("h2", { text: "Belastung" }),
        el(
          "p",
          {},
          "Verhältnis letzte 7 Tage zu Ø der letzten 4 Wochen: ",
          el("strong", { text: a.load.ratio === null ? "–" : fmt(a.load.ratio, 2) }),
          " ",
          el("span", { className: `badge ${a.load.level}`, text: a.load.status }),
        ),
        el("p", {
          className: "muted",
          text: `Akut ${fmt(a.load.acute)} Punkte · chronisch ${fmt(a.load.chronic)} Punkte/Woche. Punkte = Minuten × HF-Zone (ohne HF: Faktor 2).`,
        }),
      ),
    );

    // Trend
    const trendRows = Object.entries(SPORT_GROUPS).map(([key, group]) => {
      const t = a.trends[key];
      const tempo =
        key === "run"
          ? `${fmtPace(t.paceCurrent)} (vorher ${fmtPace(t.pacePrevious)})`
          : `${fmt(t.speedCurrent, 1)} km/h (vorher ${fmt(t.speedPrevious, 1)})`;
      return [
        [group.label],
        [`${fmt(t.current.distanceKm)} km`, "num"],
        [fmtChange(t.distanceChange), "num"],
        [`${fmt(t.current.hours, 1)} h`, "num"],
        [fmtChange(t.hoursChange), "num"],
        [tempo],
        [t.avgHrCurrent ? `${fmt(t.avgHrCurrent)} (vorher ${fmt(t.avgHrPrevious)})` : "–"],
        [t.avgWattsCurrent ? `${fmt(t.avgWattsCurrent)} W` : "–", "num"],
      ];
    });
    cards.push(
      el(
        "section",
        { className: "card" },
        el("h2", { text: "Trend: letzte 4 Wochen vs. 4 Wochen davor" }),
        table(
          [["Sport"], ["Distanz", "num"], ["±", "num"], ["Zeit", "num"], ["±", "num"], ["Tempo"], ["Ø HF"], ["Watt", "num"]],
          trendRows,
        ),
      ),
    );

    // Intensität
    const intensityCard = el("section", { className: "card" }, el("h2", { text: "Intensität (letzte 4 Wochen)" }));
    if (!profile.maxHeartrate) {
      intensityCard.append(
        el("p", { className: "muted", text: "Trage oben unter „Profil & Ziele“ deine maximale Herzfrequenz ein, um die Zonen zu sehen." }),
      );
    } else {
      const groups = [...Object.entries(SPORT_GROUPS), ["all", { label: "Alle Sportarten" }]];
      const rows = groups.map(([key, group]) => {
        const d = a.intensity[key];
        return [
          [group.label],
          ...ZONES.map((z) => [`${fmt(pct(d.minutes[z.zone], d.total))} %`, "num"]),
          [`${fmt(pct(d.noHrMinutes, d.total))} %`, "num"],
          [`${fmt(d.total / 60, 1)} h`, "num"],
        ];
      });
      const all = a.intensity.all;
      const withHr = all.total - all.noHrMinutes;
      const easy = pct(all.minutes[1] + all.minutes[2], withHr);
      const moderate = pct(all.minutes[3], withHr);
      const hard = pct(all.minutes[4] + all.minutes[5], withHr);
      intensityCard.append(
        table([["Sport"], ...ZONES.map((z) => [z.label, "num"]), ["ohne HF", "num"], ["Zeit", "num"]], rows),
        el("p", {
          text: withHr
            ? `Mit HF gemessen: locker (Z1–2) ${fmt(easy)} % · mittel (Z3) ${fmt(moderate)} % · hart (Z4–5) ${fmt(hard)} %.`
            : "Keine Aktivitäten mit Herzfrequenz in den letzten 4 Wochen.",
        }),
        el("p", {
          className: "muted",
          text:
            a.withHrDetails >= a.withHeartrate
              ? "Alle Aktivitäten mit HF werden sekundengenau ausgewertet."
              : `${a.withHrDetails} von ${a.withHeartrate} Aktivitäten mit HF sind sekundengenau ausgewertet, der Rest über die Ø-HF ` +
                "(Intervalle erscheinen dort lockerer). Unter „Aktivitäten“ → „HF-Details nachladen“ ergänzen.",
        }),
      );
    }
    cards.push(intensityCard);

    // Wochen
    const weekRows = a.weeks.map((w) => [
      [fmtWeek(w.weekStart, w.current)],
      [`${fmt(w.run.distanceKm, 1)} km`, "num"],
      [`${fmt(w.run.hours, 1)} h`, "num"],
      [w.longestRunKm ? `${fmt(w.longestRunKm, 1)} km` : "–", "num"],
      [`${fmt(w.ride.distanceKm)} km`, "num"],
      [`${fmt(w.ride.hours, 1)} h`, "num"],
      [`${fmt(w.totalHours, 1)} h`, "num"],
      [fmt(w.load), "num"],
      [w.avgRpe ? fmt(w.avgRpe, 1) : "–", "num"],
    ]);
    cards.push(
      el(
        "section",
        { className: "card" },
        el("h2", { text: "Wochenübersicht (12 Wochen)" }),
        table(
          [
            ["Woche"],
            ["Lauf", "num"],
            ["Lauf-Zeit", "num"],
            ["längster Lauf", "num"],
            ["Rad", "num"],
            ["Rad-Zeit", "num"],
            ["Gesamt", "num"],
            ["Belastung", "num"],
            ["Ø RPE", "num"],
          ],
          weekRows,
        ),
      ),
    );

    cards.push(
      el("p", {
        className: "muted",
        text: `Grundlage: ${a.activityCount} Aktivitäten, davon ${a.withHeartrate} mit Herzfrequenz (${a.withHrDetails} sekundengenau).`,
      }),
    );
    results.replaceChildren(...cards);
  }

  // ---------- Gemini-Einschätzung (nur Anzeige) ----------
  // Geplant wird ausschließlich auf der Seite „Trainingsplan“ (Saisonplan → Woche → Tage).
  // Jede Tagesplan-Erstellung liefert auch die Einschätzung, die hier angezeigt wird.

  let latest = null; // neueste gespeicherte Empfehlung

  function renderGeminiCard() {
    const card = el("section", { className: "card" }, el("h2", { text: "Einschätzung von Gemini" }));
    const link = el("a", { className: "button button-secondary", text: "Zum Trainingsplan →" });
    link.href = "#plan";

    if (!latest) {
      card.append(
        el("p", { className: "muted", text: "Noch keine Einschätzung. Sie entsteht zusammen mit dem Tagesplan auf der Seite „Trainingsplan“." }),
        el("div", { className: "button-row" }, link),
      );
      return card;
    }

    const r = latest.recommendation;
    const when = latest.createdAtMs ? new Date(latest.createdAtMs).toLocaleString("de-DE") : "";
    const loadLevel = { "zu niedrig": "low", angemessen: "ok", "erhöht": "warn", "zu hoch": "high" }[r.loadAssessment] ?? "";
    card.append(
      el("p", { className: "muted", text: `Stand ${when} · ${ANALYSIS_MODES[latest.mode]?.label ?? "Analyse"} · ${latest.model}` }),
      el("p", {}, "Belastung: ", el("span", { className: `badge ${loadLevel}`, text: r.loadAssessment })),
      el("p", { text: r.assessment }),
    );
    if (r.strengths.length) card.append(el("h3", { text: "Stärken" }), el("ul", {}, ...r.strengths.map((t) => el("li", { text: t }))));
    if (r.risks.length) card.append(el("h3", { text: "Worauf achten" }), el("ul", {}, ...r.risks.map((t) => el("li", { text: t }))));
    card.append(
      el("h3", { text: "Schwerpunkt der nächsten Wochen" }),
      el("p", { text: r.focusNextWeeks }),
      el("p", { className: "muted", text: "Den Tagesplan dazu (mit Abhaken) findest du im Trainingsplan. KI-Einschätzung ohne Gewähr." }),
      el("div", { className: "button-row" }, link),
    );
    return card;
  }

  async function load() {
    try {
      [profile, activities, latest] = await Promise.all([
        getProfile(),
        listActivities({ max: MAX_ACTIVITIES }),
        latestAnalysis(),
      ]);
      fillForm();
      renderResults();
    } catch (error) {
      results.replaceChildren();
      showMessage(`Daten konnten nicht geladen werden: ${error.message}`, "error");
    }
  }

  let unsubscribe = null;
  let loaded = false;
  unsubscribe = onUserChanged((user) => {
    if (!container.contains(results)) {
      unsubscribe?.();
      return;
    }
    if (!user) {
      results.replaceChildren(el("p", { className: "muted", text: "Bitte zuerst anmelden." }));
      return;
    }
    if (!loaded) {
      loaded = true;
      load();
    }
  });
}
