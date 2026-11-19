import {
  authErrorMessage,
  firebaseReady,
  loginWithEmail,
  logout,
  NOT_CONFIGURED_MESSAGE,
  onUserChanged,
  resetPassword,
} from "../firebase.js";

export function render(container) {
  container.innerHTML = `
    <h1>Login</h1>
    <section class="card">
      <p id="login-state" class="muted">Prüfe Login-Status …</p>

      <form id="login-form" class="form">
        <label>
          E-Mail
          <input name="email" type="email" autocomplete="username" required />
        </label>
        <label>
          Passwort
          <input name="password" type="password" autocomplete="current-password" required />
        </label>
        <div class="button-row">
          <button class="button" type="submit">Anmelden</button>
          <button id="login-reset" class="button button-secondary" type="button">Passwort vergessen?</button>
        </div>
      </form>

      <div id="login-logged-in" class="button-row" hidden>
        <a class="button" href="#aktivitaeten">Weiter zu den Aktivitäten</a>
        <button id="login-logout" class="button button-secondary" type="button">Abmelden</button>
      </div>

      <p id="login-message" class="message" role="status" hidden></p>
    </section>`;

  const state = container.querySelector("#login-state");
  const form = container.querySelector("#login-form");
  const loggedIn = container.querySelector("#login-logged-in");
  const resetButton = container.querySelector("#login-reset");
  const logoutButton = container.querySelector("#login-logout");
  const message = container.querySelector("#login-message");

  function showMessage(text, kind = "error") {
    message.textContent = text;
    message.className = `message ${kind}`;
    message.hidden = false;
  }

  if (!firebaseReady) showMessage(NOT_CONFIGURED_MESSAGE);

  let unsubscribe = null;
  unsubscribe = onUserChanged((user) => {
    // Seite wurde inzwischen gewechselt → Listener lösen.
    if (!container.contains(state)) {
      unsubscribe?.();
      return;
    }
    state.textContent = user ? `Angemeldet als ${user.email}.` : "Du bist nicht angemeldet.";
    form.hidden = Boolean(user);
    loggedIn.hidden = !user;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.hidden = true;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await loginWithEmail(form.email.value.trim(), form.password.value);
      form.reset();
      // Zurück zur ursprünglich gewünschten Seite (von der Login-Sperre gemerkt)
      let target = "aktivitaeten";
      try {
        target = sessionStorage.getItem("tpa.returnTo") || target;
        sessionStorage.removeItem("tpa.returnTo");
      } catch {
        /* ignorieren */
      }
      location.hash = `#${target}`;
    } catch (error) {
      showMessage(authErrorMessage(error));
    } finally {
      submit.disabled = false;
    }
  });

  resetButton.addEventListener("click", async () => {
    const email = form.email.value.trim();
    if (!email) {
      showMessage("Bitte zuerst die E-Mail-Adresse eingeben.");
      return;
    }
    try {
      await resetPassword(email);
      showMessage("Falls ein Konto existiert, wurde eine E-Mail zum Zurücksetzen verschickt.", "ok");
    } catch (error) {
      showMessage(authErrorMessage(error));
    }
  });

  logoutButton.addEventListener("click", async () => {
    try {
      await logout();
    } catch (error) {
      showMessage(authErrorMessage(error));
    }
  });
}
