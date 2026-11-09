import { clearAllSettings, getSetting, hasSetting, setSetting, SETTING_KEYS } from "../settings.js";

export function render(container) {
  container.innerHTML = `
    <h1>Einstellungen</h1>
    <section class="card">
      <p>
        Schlüssel werden <strong>nur im localStorage dieses Browsers</strong> gespeichert –
        nicht im Code, nicht im Repository und nicht in Firestore.
      </p>
      <form id="settings-form" class="form" autocomplete="off"></form>
      <p id="settings-message" class="message" role="status" hidden></p>
    </section>
    <section class="card">
      <h2>Gespeicherte Werte</h2>
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

  clearButton.addEventListener("click", () => {
    if (!confirm("Wirklich alle Schlüssel und Strava-Tokens aus diesem Browser löschen?")) return;
    const ok = clearAllSettings();
    refresh();
    showMessage(ok ? "Alle Schlüssel wurden gelöscht." : "Löschen fehlgeschlagen.", ok ? "ok" : "error");
  });

  refresh();
}
