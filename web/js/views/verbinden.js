import { hasSetting } from "../settings.js";
import { disconnect, getRedirectUri, isConnected, startAuthorization, takeFlash, tokenExpiry } from "../strava.js";

export function render(container) {
  container.innerHTML = `
    <h1>Mit Strava verbinden</h1>
    <p id="connect-message" class="message" role="status" hidden></p>
    <section class="card">
      <p>Status: <strong id="connect-status"></strong></p>
      <p id="connect-expiry" class="muted"></p>
      <div class="button-row">
        <button id="connect-start" class="button" type="button">Mit Strava verbinden</button>
        <button id="connect-stop" class="button button-secondary" type="button">Verbindung trennen</button>
      </div>
      <p id="connect-hint" class="muted"></p>
    </section>
    <section class="card">
      <h2>So funktioniert es</h2>
      <p class="muted">
        Du wirst zu Strava weitergeleitet und bestätigst dort den Zugriff. Wichtig: den Haken bei
        „Daten zu deinen Aktivitäten anzeigen, auch private“ gesetzt lassen. Danach kommst du hierher zurück.
        Die Verbindung wird in deinem geschützten Firebase-Bereich gespeichert – nach dem Login steht sie
        auf allen Geräten und Adressen zur Verfügung, du musst dich nur einmal verbinden.
      </p>
      <p class="muted">Rückleitungs-Adresse: <code id="connect-redirect"></code></p>
    </section>`;

  const message = container.querySelector("#connect-message");
  const status = container.querySelector("#connect-status");
  const expiry = container.querySelector("#connect-expiry");
  const startButton = container.querySelector("#connect-start");
  const stopButton = container.querySelector("#connect-stop");
  const hint = container.querySelector("#connect-hint");
  container.querySelector("#connect-redirect").textContent = getRedirectUri();

  function showMessage(text, kind) {
    message.textContent = text;
    message.className = `message ${kind}`;
    message.hidden = false;
  }

  function refresh() {
    const connected = isConnected();
    const hasCredentials = hasSetting("stravaClientId") && hasSetting("stravaClientSecret");
    status.textContent = connected ? "verbunden" : "nicht verbunden";
    const expires = tokenExpiry();
    expiry.textContent =
      connected && expires
        ? `Access Token gültig bis ${expires.toLocaleString("de-DE")} (wird automatisch erneuert).`
        : "";
    startButton.textContent = connected ? "Erneut verbinden" : "Mit Strava verbinden";
    startButton.disabled = !hasCredentials;
    stopButton.hidden = !connected;
    hint.textContent = hasCredentials
      ? ""
      : "Trage zuerst Strava Client ID und Client Secret unter „Einstellungen“ ein.";
  }

  const flash = takeFlash();
  if (flash) showMessage(flash.text, flash.kind);

  startButton.addEventListener("click", () => {
    try {
      startAuthorization();
    } catch (error) {
      showMessage(error.message, "error");
    }
  });

  stopButton.addEventListener("click", async () => {
    if (!confirm("Verbindung zu Strava trennen? Bereits importierte Aktivitäten bleiben gespeichert.")) return;
    try {
      await disconnect();
      showMessage("Verbindung zu Strava getrennt.", "ok");
    } catch (error) {
      showMessage(`Getrennt (lokal). Hinweis: ${error.message}`, "error");
    }
    refresh();
  });

  refresh();
}
