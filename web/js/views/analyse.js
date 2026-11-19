export function render(container) {
  container.innerHTML = `
    <h1>Analyse &amp; Empfehlungen</h1>
    <section class="card">
      <p class="muted">Hier erscheinen später Auswertungen und Empfehlungen von Gemini.</p>
      <p class="todo">
        TODO: Wochenumfang, Intensitätsverteilung und Trends berechnen, eine kompakte
        Zusammenfassung an <code>callGemini()</code> schicken und das Ergebnis unter
        <code>users/{uid}/analyses</code> speichern.
      </p>
    </section>`;
}
