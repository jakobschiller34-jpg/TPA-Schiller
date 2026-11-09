export function render(container) {
  container.innerHTML = `
    <h1>Aktivitäten</h1>
    <section class="card">
      <p class="muted">Hier erscheint später die Liste deiner Strava-Aktivitäten.</p>
      <p class="todo">
        TODO: Aktivitäten über <code>fetchActivities()</code> laden, in Firestore unter
        <code>users/{uid}/activities</code> speichern und hier als Tabelle anzeigen.
      </p>
    </section>`;
}
