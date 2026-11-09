import { hasSetting } from "../settings.js";

export function render(container) {
  const connected = hasSetting("stravaAccessToken");

  container.innerHTML = `
    <h1>Mit Strava verbinden</h1>
    <section class="card">
      <p>Status: <strong>${connected ? "verbunden" : "nicht verbunden"}</strong></p>
      <p class="todo">
        TODO: Button startet die Weiterleitung über <code>buildAuthorizeUrl()</code> in strava.js.
        Vorher Strava Client ID und Client Secret unter <a href="#einstellungen">Einstellungen</a> eintragen.
      </p>
      <button class="button" type="button" disabled>Mit Strava verbinden</button>
    </section>`;
}
