export function render(container) {
  container.innerHTML = `
    <h1>Trainingsplan</h1>
    <section class="card">
      <p class="muted">Hier erscheint später dein mehrwöchiger Trainingsplan.</p>
      <p class="todo">
        TODO: Plan mit Gemini als JSON erzeugen, gegen ein Schema prüfen, unter
        <code>users/{uid}/plans</code> speichern und hier wochenweise anzeigen.
      </p>
    </section>`;
}
