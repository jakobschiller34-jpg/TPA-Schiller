// Einstiegspunkt: Hash-Router, Login-Status im Kopfbereich, Strava-Callback-Erkennung.

import { currentUser, firebaseReady, logout, onUserChanged } from "./firebase.js";
import { pullMissingSecrets } from "./secrets-sync.js";
import { handleCallback } from "./strava.js";

import * as login from "./views/login.js";
import * as verbinden from "./views/verbinden.js";
import * as aktivitaeten from "./views/aktivitaeten.js";
import * as analyse from "./views/analyse.js";
import * as plan from "./views/plan.js";
import * as einstellungen from "./views/einstellungen.js";

/** Jede Route verweist auf ein Modul mit `render(container)`. */
const routes = { login, verbinden, aktivitaeten, analyse, plan, einstellungen };
const DEFAULT_ROUTE = "login";

const view = document.getElementById("view");
const navLinks = document.querySelectorAll(".main-nav a[data-route]");
const userName = document.getElementById("user-name");
const logoutButton = document.getElementById("logout-button");

/** Seiten, die ohne Anmeldung erreichbar sind. */
const PUBLIC_ROUTES = new Set(["login"]);
/** Merkt sich die gewünschte Seite, um nach dem Login dorthin zurückzukehren. */
const RETURN_KEY = "tpa.returnTo"; // wird in views/login.js ausgelesen
/** Spätestens nach dieser Zeit gilt der Login-Status als bekannt (falls Firebase hängt). */
const AUTH_WAIT_MS = 5000;

let authUser = null;
let authReady = !firebaseReady; // ohne Firebase-Konfiguration: keine Sperre

function currentRoute() {
  return location.hash.replace(/^#\/?/, "") || DEFAULT_ROUTE;
}

function render() {
  const name = currentRoute();
  const page = routes[name];

  // Login-Sperre: Solange der Login-Status unbekannt ist, warten; ohne Anmeldung → #login.
  // Ohne Firebase-Konfiguration bleibt die Navigation frei (Entwicklung).
  if (firebaseReady && !authReady) {
    view.innerHTML = `<p class="muted">Prüfe Anmeldung …</p>`;
    return;
  }
  // currentUser(): direkt nach dem Login schon gesetzt, auch wenn onUserChanged noch nicht lief
  if (firebaseReady && !(authUser ?? currentUser()) && !PUBLIC_ROUTES.has(name)) {
    try {
      if (routes[name]) sessionStorage.setItem(RETURN_KEY, name);
    } catch {
      /* ignorieren */
    }
    location.replace("#login"); // löst hashchange → render() aus
    return;
  }

  for (const link of navLinks) {
    const active = link.dataset.route === name;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }

  view.replaceChildren();
  if (!page) {
    view.innerHTML = `
      <h1>Seite nicht gefunden</h1>
      <p><a href="#${DEFAULT_ROUTE}">Zur Startseite</a></p>`;
    return;
  }

  try {
    page.render(view);
  } catch (error) {
    console.error(error);
    const message = document.createElement("p");
    message.className = "message error";
    message.textContent = `Fehler beim Anzeigen der Seite: ${error.message}`;
    view.append(message);
  }
  // Fokus für Screenreader auf den neuen Inhalt setzen, ohne die Kopfzeile wegzuscrollen.
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

/**
 * Strava leitet nach dem Login auf redirect_uri?code=…&state=… zurück.
 * Die Parameter stehen in der Query (location.search), nicht im Hash – deshalb hier abfangen.
 */
async function handleStravaRedirect() {
  const params = new URLSearchParams(location.search);
  if (!params.has("code") && !params.has("error")) return;

  // Query sofort aus der Adresszeile entfernen (Code ist nur einmal gültig).
  history.replaceState(null, "", `${location.pathname}#verbinden`);
  try {
    await handleCallback(params);
  } catch (error) {
    // Die Meldung zeigt die Seite #verbinden an (strava.takeFlash()).
    console.warn("Strava-Callback:", error.message);
  }
}

onUserChanged((user) => {
  userName.textContent = user ? (user.displayName ?? user.email ?? "Angemeldet") : "Nicht angemeldet";
  logoutButton.hidden = !user;

  const firstAnswer = !authReady;
  authUser = user;
  authReady = true;
  // Erstes Ergebnis: Seite jetzt rendern. Abmeldung: Sperre greift sofort.
  if (firstAnswer || (!user && !PUBLIC_ROUTES.has(currentRoute()))) render();

  // Nach dem Login fehlende Schlüssel aus Firestore in den localStorage holen.
  if (user) {
    pullMissingSecrets()
      .then((count) => {
        if (count > 0 && currentRoute() === "einstellungen") render();
      })
      .catch((error) => console.warn("Schlüssel aus Firebase laden:", error.message));
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    await logout();
    location.hash = "#login";
  } catch (error) {
    console.error(error);
  }
});

window.addEventListener("hashchange", render);

await handleStravaRedirect();
render();

// Falls Firebase nicht antwortet, nicht ewig „Prüfe Anmeldung …“ zeigen.
setTimeout(() => {
  if (!authReady) {
    authReady = true;
    render();
  }
}, AUTH_WAIT_MS);
