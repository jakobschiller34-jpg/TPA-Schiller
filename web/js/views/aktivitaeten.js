import { currentUser, listActivities, newestActivityEpoch, onUserChanged, saveActivities } from "../firebase.js";
import { backfillHrDetails, DEFAULT_MAX_REQUESTS, pendingHrActivities } from "../hr-details.js";
import { fetchActivitiesSince, isConnected } from "../strava.js";
import { renderRatingCard } from "./rating.js";

const FIRST_IMPORT_DAYS = 365; // Erstimport: die letzten 12 Monate
const LIST_LIMIT = 100; // Zeilen in der Tabelle
const LOAD_LIMIT = 1000; // für die Zählung offener HF-Details
const AUTO_HR_REQUESTS = 40; // nach dem Import automatisch nachladen (Rest per Button)

const SPORT_LABELS = {
  Run: "Lauf",
  TrailRun: "Traillauf",
  VirtualRun: "Lauf (virtuell)",
  Ride: "Rad",
  VirtualRide: "Rad (virtuell)",
  GravelRide: "Gravel",
  MountainBikeRide: "MTB",
  EBikeRide: "E-Bike",
  Swim: "Schwimmen",
  Walk: "Gehen",
  Hike: "Wandern",
  WeightTraining: "Krafttraining",
  Workout: "Training",
  Yoga: "Yoga",
  Rowing: "Rudern",
  NordicSki: "Langlauf",
  AlpineSki: "Ski alpin",
};

// ---------- Formatierung ----------

function formatDate(isoLocal) {
  if (!isoLocal) return "–";
  // start_date_local ist lokale Zeit mit "Z" – deshalb in UTC formatieren, um nicht zu verschieben.
  return new Date(isoLocal).toLocaleString("de-DE", {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDistance(meters) {
  return meters ? `${(meters / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} km` : "–";
}

function formatDuration(seconds) {
  if (!seconds) return "–";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")} h` : `${m} min`;
}

function formatNumber(value, unit) {
  return value || value === 0 ? `${Math.round(value)} ${unit}` : "–";
}

// ---------- Seite ----------

export function render(container) {
  container.innerHTML = `
    <h1>Aktivitäten</h1>
    <section class="card">
      <div class="button-row">
        <button id="act-import" class="button" type="button" disabled>Neue Aktivitäten importieren</button>
        <button id="act-hr" class="button button-secondary" type="button" disabled>HF-Details nachladen</button>
      </div>
      <p id="act-message" class="message" role="status" hidden></p>
      <p id="act-hint" class="muted">Prüfe Login-Status …</p>
    </section>
    <section id="act-rating" class="card" hidden></section>
    <section class="card">
      <h2 id="act-title">Gespeicherte Aktivitäten</h2>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Datum</th><th>Sport</th><th>Name</th>
              <th class="num">Distanz</th><th class="num">Dauer</th>
              <th class="num">Höhe</th><th class="num">Ø HF</th>
              <th title="Herzfrequenz sekundengenau ausgewertet">HF-Details</th>
              <th class="num" title="Anstrengung 1–10">RPE</th>
            </tr>
          </thead>
          <tbody id="act-rows"></tbody>
        </table>
      </div>
      <p id="act-empty" class="muted" hidden>Noch keine Aktivitäten gespeichert.</p>
    </section>`;

  const importButton = container.querySelector("#act-import");
  const hrButton = container.querySelector("#act-hr");
  let allActivities = [];
  let busy = false;
  const message = container.querySelector("#act-message");
  const hint = container.querySelector("#act-hint");
  const title = container.querySelector("#act-title");
  const rows = container.querySelector("#act-rows");
  const empty = container.querySelector("#act-empty");
  const ratingSection = container.querySelector("#act-rating");

  const describe = (a) =>
    `${formatDate(a.startDateLocal)} · ${SPORT_LABELS[a.sportType] ?? a.sportType} · ${a.name} · ${formatDuration(a.movingTime)}`;

  function renderAll() {
    renderRatingCard(ratingSection, allActivities, { describe, onChange: renderAll });
    renderRows(allActivities.slice(0, LIST_LIMIT));
  }

  function showMessage(text, kind = "ok") {
    message.textContent = text;
    message.className = `message ${kind}`;
    message.hidden = false;
  }

  function renderRows(activities) {
    rows.replaceChildren(
      ...activities.map((a) => {
        const tr = document.createElement("tr");
        const cells = [
          [formatDate(a.startDateLocal)],
          [SPORT_LABELS[a.sportType] ?? a.sportType],
          [a.name], // textContent – Namen nie als HTML einsetzen
          [formatDistance(a.distance), "num"],
          [formatDuration(a.movingTime), "num"],
          [formatNumber(a.elevationGain, "m"), "num"],
          [formatNumber(a.averageHeartrate, "bpm"), "num"],
          [!a.averageHeartrate ? "" : a.hrHistogram ? "✓" : a.hrChecked ? "keine" : "offen"],
          [a.rpe ? String(a.rpe) : "", "num"],
        ];
        for (const [text, cls] of cells) {
          const td = document.createElement("td");
          td.textContent = text;
          if (cls) td.className = cls;
          tr.append(td);
        }
        return tr;
      }),
    );
    empty.hidden = activities.length > 0;
    title.textContent = activities.length
      ? `Gespeicherte Aktivitäten (neueste ${activities.length})`
      : "Gespeicherte Aktivitäten";
  }

  async function loadList() {
    try {
      allActivities = await listActivities({ max: LOAD_LIMIT });
      renderAll();
      updateState(currentUser());
    } catch (error) {
      showMessage(`Aktivitäten konnten nicht geladen werden: ${error.message}`, "error");
    }
  }

  function updateState(user) {
    const connected = isConnected();
    const pending = pendingHrActivities(allActivities).length;
    importButton.disabled = busy || !user || !connected;
    hrButton.disabled = busy || !user || !connected || pending === 0;
    hrButton.textContent = pending ? `HF-Details nachladen (${pending} offen)` : "HF-Details vollständig";
    if (!user) hint.textContent = "Bitte zuerst anmelden.";
    else if (!connected) hint.textContent = "Bitte zuerst unter „Strava verbinden“ mit Strava verbinden.";
    else hint.textContent = "";
  }

  /** Lädt HF-Details in einer Portion und meldet das Ergebnis. */
  async function runHrBackfill(maxRequests, prefix = "") {
    const result = await backfillHrDetails({
      activities: allActivities,
      maxRequests,
      onProgress: (done, total) => showMessage(`${prefix}HF-Details: ${done} von ${total} geladen …`),
    });
    let text = `${prefix}HF-Details für ${result.done} Aktivitäten geladen.`;
    if (result.rateLimited) text += ` Strava-Limit erreicht – noch ${result.remaining} offen, bitte in 15 Minuten fortsetzen.`;
    else if (result.remaining) text += ` Noch ${result.remaining} offen – später erneut klicken (Strava erlaubt ca. 100 Anfragen pro 15 Minuten).`;
    showMessage(text, result.rateLimited ? "error" : "ok");
    renderAll();
  }

  hrButton.addEventListener("click", async () => {
    busy = true;
    updateState(currentUser());
    try {
      await runHrBackfill(DEFAULT_MAX_REQUESTS);
    } catch (error) {
      showMessage(error.message, "error");
    } finally {
      busy = false;
      updateState(currentUser());
    }
  });

  importButton.addEventListener("click", async () => {
    busy = true;
    updateState(currentUser());
    try {
      const newest = await newestActivityEpoch();
      const after = newest ?? Math.floor(Date.now() / 1000) - FIRST_IMPORT_DAYS * 24 * 3600;
      showMessage(newest ? "Lade neue Aktivitäten von Strava …" : "Erstimport der letzten 12 Monate läuft …");

      const activities = await fetchActivitiesSince({
        after,
        onPage: (count) => showMessage(`${count} Aktivitäten von Strava geladen …`),
      });
      if (activities.length) {
        showMessage(`Speichere ${activities.length} Aktivitäten …`);
        await saveActivities(activities);
      }
      const imported = activities.length ? `${activities.length} Aktivitäten importiert. ` : "Keine neuen Aktivitäten. ";
      showMessage(imported);
      await loadList();
      if (pendingHrActivities(allActivities).length) await runHrBackfill(AUTO_HR_REQUESTS, imported);
    } catch (error) {
      showMessage(error.message, "error");
    } finally {
      busy = false;
      updateState(currentUser());
    }
  });

  // Auf den Login-Status warten, dann Liste laden (Listener löst sich beim Seitenwechsel).
  let unsubscribe = null;
  let loaded = false;
  unsubscribe = onUserChanged((user) => {
    if (!container.contains(rows)) {
      unsubscribe?.();
      return;
    }
    updateState(user);
    if (user && !loaded) {
      loaded = true;
      loadList();
    }
  });
}
