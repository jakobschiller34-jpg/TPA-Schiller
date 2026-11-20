// Einstiegspunkt: Hash-Router, Login-Status im Kopfbereich, Strava-Callback-Erkennung.

import {
  currentUser,
  firebaseReady,
  getStravaAthlete,
  logout,
  onUserChanged,
  saveStravaAthlete,
} from "./firebase.js";
import { clearRemoteStravaTokens, pullMissingSecrets, pushStravaTokens, reconcileStravaTokens } from "./secrets-sync.js";
import { cachedAthlete, fetchAthlete, handleCallback, isConnected, setTokenSyncHooks } from "./strava.js";

// Strava-Verbindung über Firestore auf allen Geräten/Adressen erhalten (nur wenn angemeldet).
setTokenSyncHooks({
  onStored: () => {
    if (currentUser()) pushStravaTokens();
  },
  beforeRefresh: async () => {
    if (currentUser()) await reconcileStravaTokens();
  },
  onCleared: () => {
    if (currentUser()) clearRemoteStravaTokens();
  },
});

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
const userAvatar = document.getElementById("user-avatar");
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

/** Zeigt Profilbild oder Initialen (aus Strava-Name bzw. E-Mail). */
function showAvatar(user, athlete) {
  userAvatar.replaceChildren();
  userAvatar.hidden = !user;
  if (!user) return;
  if (athlete?.avatarUrl) {
    const img = document.createElement("img");
    img.src = athlete.avatarUrl;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => showAvatar(user, { ...athlete, avatarUrl: null }));
    userAvatar.append(img);
    return;
  }
  const name = [athlete?.firstname, athlete?.lastname].filter(Boolean).join(" ") || user.email || "?";
  const initials = name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
  userAvatar.textContent = initials || "?";
}

/**
 * Profilbild besorgen: lokaler Cache → Firestore → Strava (nur wenn verbunden).
 * Neu von Strava geholte Daten werden in Firestore abgelegt (für andere Geräte).
 */
async function loadAvatar(user) {
  showAvatar(user, cachedAthlete());
  try {
    let athlete = cachedAthlete();
    const stored = await getStravaAthlete();
    if (athlete && JSON.stringify(athlete) !== JSON.stringify(stored)) await saveStravaAthlete(athlete);
    athlete ??= stored;
    if (!athlete && isConnected()) {
      athlete = await fetchAthlete();
      if (athlete) await saveStravaAthlete(athlete);
    }
    if (currentUser()?.uid === user.uid) showAvatar(user, athlete);
  } catch (error) {
    console.warn("Profilbild:", error.message);
  }
}

onUserChanged((user) => {
  userName.textContent = user ? (user.displayName ?? user.email ?? "Angemeldet") : "Nicht angemeldet";
  logoutButton.hidden = !user;
  if (user) loadAvatar(user);
  else showAvatar(null, null);

  const firstAnswer = !authReady;
  authUser = user;
  authReady = true;
  // Erstes Ergebnis: Seite jetzt rendern. Abmeldung: Sperre greift sofort.
  if (firstAnswer || (!user && !PUBLIC_ROUTES.has(currentRoute()))) render();

  // Nach dem Login fehlende Schlüssel holen und Strava-Tokens abgleichen
  // (z. B. Verbindung, die vor dem Login über die Strava-Rückleitung entstand, hochladen).
  if (user) {
    pullMissingSecrets()
      .then((count) => {
        if (count > 0 && ["einstellungen", "verbinden", "aktivitaeten"].includes(currentRoute())) render();
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
