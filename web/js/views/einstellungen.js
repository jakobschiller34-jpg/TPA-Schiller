import { currentUser } from "../firebase.js";
import { deleteRemoteSecrets, pullSecrets, pushSecrets } from "../secrets-sync.js";
import { clearAllSettings, getSetting, hasSetting, setSetting, SETTING_KEYS } from "../settings.js";

export function render(container) {
  container.innerHTML = `
    <h1>Einstellungen</h1>
    <section class="card">
      <p>
        Schlüssel werden im localStorage dieses Browsers gespeichert – nie im Code oder im Repository.
        Über „In Firebase speichern“ landen sie zusätzlich in deinem Firestore-Bereich, den nur
        dein angemeldeter Account lesen kann. Nach dem Login auf einem anderen Gerät werden sie
        dann automatisch übernommen.
      </p>
      <form id="settings-form" class="form" autocomplete="off"></form>
      <p id="settings-message" class="message" role="status" hidden></p>
    </section>
    <section class="card">
      <h2>Firebase-Abgleich</h2>
      <p class="muted">Erfordert Anmeldung. Abgeglichen werden Strava Client ID, Strava Client Secret, Gemini API-Key und die Strava-Verbindung (Tokens).</p>
      <div class="button-row">
        <button id="settings-push" class="button" type="button">In Firebase speichern</button>
        <button id="settings-pull" class="button button-secondary" type="button">Aus Firebase laden</button>
      </div>
    </section>
    <section class="card">
      <h2>Gespeicherte Werte (dieser Browser)</h2>
      <ul id="settings-status"></ul>
      <button id="settings-clear" class="button button-danger" type="button">Alle Schlüssel löschen</button>
    </section>`;

  const form = container.querySelector("#settings-form");
  const statusList = container.querySelector("#settings-status");
  const message = container.querySelector("#settings-message");
  const clearButton = container.querySelector("#settings-clear");

  function showMessage(text, kind) {
    message.textContent = text;
    message.className = `message ${kind}`;
    message.hidden = false;
  }

  // Eingabefelder für alle editierbaren Schlüssel. Gespeicherte Werte werden nie ins DOM
  // geschrieben – leeres Feld bedeutet „unverändert lassen“.
  for (const [key, meta] of Object.entries(SETTING_KEYS)) {
    if (!meta.editable) continue;
    const label = document.createElement("label");
    label.textContent = meta.label;
    const input = document.createElement("input");
    input.name = key;
    input.type = meta.secret ? "password" : "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    const hint = document.createElement("span");
    hint.className = "hint";
    label.append(input, hint);
    form.append(label);
  }
  const buttons = document.createElement("div");
  buttons.className = "button-row";
  const save = document.createElement("button");
  save.className = "button";
  save.type = "submit";
  save.textContent = "Speichern";
  buttons.append(save);
  form.append(buttons);

  function refresh() {
    for (const input of form.querySelectorAll("input")) {
      const set = hasSetting(input.name);
      input.value = "";
      input.placeholder = set ? "gespeichert – leer lassen, um nichts zu ändern" : "";
      input.nextElementSibling.textContent = set ? "Gesetzt" : "Nicht gesetzt";
    }
    statusList.replaceChildren(
      ...Object.entries(SETTING_KEYS).map(([key, meta]) => {
        const item = document.createElement("li");
        const value = getSetting(key);
        // Nicht-geheime Werte (Client ID, Ablaufzeit) dürfen angezeigt werden.
        item.textContent = `${meta.label}: ${value ? (meta.secret ? "gesetzt" : value) : "nicht gesetzt"}`;
        return item;
      }),
    );
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    let ok = true;
    for (const input of form.querySelectorAll("input")) {
      const value = input.value.trim();
      if (value) ok = setSetting(input.name, value) && ok;
    }
    refresh();
    showMessage(ok ? "Gespeichert." : "Speichern fehlgeschlagen (localStorage nicht verfügbar?).", ok ? "ok" : "error");
  });

  container.querySelector("#settings-push").addEventListener("click", async () => {
    try {
      const count = await pushSecrets();
      showMessage(`${count} Schlüssel in Firebase gespeichert.`, "ok");
    } catch (error) {
      showMessage(`Speichern in Firebase fehlgeschlagen: ${error.message}`, "error");
    }
  });

  container.querySelector("#settings-pull").addEventListener("click", async () => {
    try {
      const count = await pullSecrets({ overwrite: true });
      refresh();
      showMessage(
        count ? `${count} Schlüssel aus Firebase übernommen.` : "In Firebase sind noch keine Schlüssel gespeichert.",
        count ? "ok" : "error",
      );
    } catch (error) {
      showMessage(`Laden aus Firebase fehlgeschlagen: ${error.message}`, "error");
    }
  });

  clearButton.addEventListener("click", async () => {
    const loggedIn = Boolean(currentUser());
    const question = loggedIn
      ? "Wirklich alle Schlüssel und Strava-Tokens aus diesem Browser UND aus Firebase löschen?"
      : "Wirklich alle Schlüssel und Strava-Tokens aus diesem Browser löschen?\n(Nicht angemeldet – Firebase bleibt unverändert.)";
    if (!confirm(question)) return;

    const ok = clearAllSettings();
    refresh();
    if (!ok) {
      showMessage("Löschen im Browser fehlgeschlagen.", "error");
      return;
    }
    if (!loggedIn) {
      showMessage("Alle Schlüssel in diesem Browser wurden gelöscht.", "ok");
      return;
    }
    try {
      await deleteRemoteSecrets();
      showMessage("Alle Schlüssel wurden im Browser und in Firebase gelöscht.", "ok");
    } catch (error) {
      showMessage(`Im Browser gelöscht, in Firebase fehlgeschlagen: ${error.message}`, "error");
    }
  });

  refresh();
}
