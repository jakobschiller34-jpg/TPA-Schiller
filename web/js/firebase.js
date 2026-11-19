// Firebase-Initialisierung, Login und Logout.
//
// Das SDK wird per CDN von gstatic.com mit fester Versionsnummer geladen (kein npm, kein Build).
// Beim Aktualisieren alle drei URLs gemeinsam auf dieselbe Version setzen.

import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

export const NOT_CONFIGURED_MESSAGE =
  "Firebase ist noch nicht konfiguriert. Trage die Werte in web/js/firebase-config.js ein (siehe README).";

export const firebaseReady = isFirebaseConfigured();

// Ohne echte Konfiguration wird Firebase gar nicht erst initialisiert, damit die App
// trotzdem lädt und man zwischen den Platzhalterseiten navigieren kann.
export const app = firebaseReady ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

function requireAuth() {
  if (!auth) throw new Error(NOT_CONFIGURED_MESSAGE);
  return auth;
}

/**
 * Anmeldung mit E-Mail und Passwort.
 * Eine Registrierung gibt es in der App bewusst nicht: Das (einzige) Konto wird in der
 * Firebase-Konsole unter Authentication → Users angelegt.
 */
export async function loginWithEmail(email, password) {
  const result = await signInWithEmailAndPassword(requireAuth(), email, password);
  return result.user;
}

/** Schickt eine E-Mail zum Zurücksetzen des Passworts. */
export async function resetPassword(email) {
  await sendPasswordResetEmail(requireAuth(), email);
}

/** Übersetzt Firebase-Auth-Fehlercodes in verständliche deutsche Meldungen. */
export function authErrorMessage(error) {
  switch (error?.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "E-Mail oder Passwort ist falsch.";
    case "auth/invalid-email":
      return "Die E-Mail-Adresse ist ungültig.";
    case "auth/missing-password":
      return "Bitte ein Passwort eingeben.";
    case "auth/too-many-requests":
      return "Zu viele Versuche. Bitte später erneut probieren.";
    case "auth/operation-not-allowed":
      return "E-Mail/Passwort-Anmeldung ist in Firebase nicht aktiviert (Authentication → Sign-in method).";
    case "auth/network-request-failed":
      return "Keine Verbindung zu Firebase.";
    default:
      return error?.message ?? "Unbekannter Fehler.";
  }
}

export async function logout() {
  await signOut(requireAuth());
}

/** Ruft callback(user | null) bei jeder Änderung des Login-Status auf. */
export function onUserChanged(callback) {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

export function currentUser() {
  return auth?.currentUser ?? null;
}

// ---------- Schlüssel in Firestore: users/{uid}/private/secrets ----------
//
// Die Schlüssel liegen im Klartext in einem Dokument, das laut firestore.rules nur der
// angemeldete Eigentümer lesen und schreiben darf. Schutz = Firebase-Login + Security Rules.
// Wer das Login-Passwort kennt, kann die Schlüssel lesen → starkes Passwort verwenden.

function requireUser() {
  const user = requireAuth().currentUser;
  if (!user) throw new Error("Bitte zuerst anmelden.");
  return user;
}

function secretsRef(uid) {
  return doc(db, "users", uid, "private", "secrets");
}

/**
 * Speichert die Schlüssel in Firestore.
 * Neue nicht-leere Werte überschreiben vorhandene; fehlende Werte bleiben aus Firestore erhalten.
 * Das Dokument wird komplett neu geschrieben (ohne merge) und enthält nur `allowedKeys` –
 * so verschwinden veraltete Felder (z. B. ein früherer anthropicApiKey), die die Rules ablehnen würden.
 */
export async function saveSecretsToFirestore(values, allowedKeys) {
  const user = requireUser();
  const ref = secretsRef(user.uid);
  const snapshot = await getDoc(ref);
  const existing = snapshot.exists() ? snapshot.data() : {};
  const data = {};
  for (const key of allowedKeys) {
    const value = values[key] || existing[key];
    if (typeof value === "string" && value) data[key] = value;
  }
  await setDoc(ref, { ...data, updatedAt: serverTimestamp() });
}

/** Lädt die Schlüssel aus Firestore. Gibt {} zurück, wenn noch nichts gespeichert ist. */
export async function loadSecretsFromFirestore() {
  const user = requireUser();
  const snapshot = await getDoc(secretsRef(user.uid));
  if (!snapshot.exists()) return {};
  const { updatedAt, ...secrets } = snapshot.data();
  void updatedAt;
  return secrets;
}

export async function deleteSecretsFromFirestore() {
  const user = requireUser();
  await deleteDoc(secretsRef(user.uid));
}

// TODO: Firestore-Hilfsfunktionen für das übrige Datenmodell (siehe README / firestore.rules):
//   users/{uid}/activities/{activityId}
//   users/{uid}/analyses/{analysisId}
//   users/{uid}/plans/{planId}
// z. B. saveActivities(uid, activities), listActivities(uid), savePlan(uid, plan), …
