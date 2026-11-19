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
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
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

// ---------- Aktivitäten: users/{uid}/activities/{stravaActivityId} ----------

function activitiesRef(uid) {
  return collection(db, "users", uid, "activities");
}

/**
 * Speichert normalisierte Aktivitäten (Dokument-ID = Strava-ID).
 * merge: zusätzliche Felder wie hrHistogram bleiben bei erneutem Import erhalten.
 * Firestore erlaubt max. 500 Schreibvorgänge pro Batch.
 */
export async function saveActivities(activities) {
  const user = requireUser();
  const col = activitiesRef(user.uid);
  for (let i = 0; i < activities.length; i += 400) {
    const batch = writeBatch(db);
    for (const activity of activities.slice(i, i + 400)) {
      batch.set(doc(col, String(activity.id)), { ...activity, importedAt: serverTimestamp() }, { merge: true });
    }
    await batch.commit();
  }
}

/** Ergänzt einzelne Felder einer gespeicherten Aktivität (z. B. hrHistogram). */
export async function updateActivity(activityId, fields) {
  const user = requireUser();
  await setDoc(doc(activitiesRef(user.uid), String(activityId)), fields, { merge: true });
}

/** Neueste gespeicherte Aktivitäten zuerst. */
export async function listActivities({ max = 100 } = {}) {
  const user = requireUser();
  const snapshot = await getDocs(query(activitiesRef(user.uid), orderBy("startEpoch", "desc"), limit(max)));
  return snapshot.docs.map((d) => d.data());
}

/** Startzeit (Unix-Sekunden) der neuesten gespeicherten Aktivität oder null. */
export async function newestActivityEpoch() {
  const [newest] = await listActivities({ max: 1 });
  return newest?.startEpoch ?? null;
}

// ---------- Profil & Ziele: users/{uid} (keine Geheimnisse) ----------

function userRef(uid) {
  return doc(db, "users", uid);
}

/** Liest das Profil ({ maxHeartrate, restingHeartrate, runGoal, rideGoal }) oder {}. */
export async function getProfile() {
  const user = requireUser();
  const snapshot = await getDoc(userRef(user.uid));
  return snapshot.exists() ? (snapshot.data().profile ?? {}) : {};
}

export async function saveProfile(profile) {
  const user = requireUser();
  await setDoc(userRef(user.uid), { profile, profileUpdatedAt: serverTimestamp() }, { merge: true });
}

// ---------- Empfehlungen: users/{uid}/analyses/{autoId} ----------

function analysesRef(uid) {
  return collection(db, "users", uid, "analyses");
}

/** Speichert eine KI-Empfehlung samt der gesendeten Zusammenfassung. */
export async function saveAnalysis({ model, mode = null, summary, recommendation }) {
  const user = requireUser();
  // createdAtMs zusätzlich, damit das Datum sofort (vor Server-Bestätigung) anzeigbar ist.
  const ref = await addDoc(analysesRef(user.uid), {
    model,
    mode,
    summary,
    recommendation,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  });
  return ref.id;
}

/** Gespeicherte Empfehlungen, neueste zuerst, jeweils mit `id`. */
export async function listAnalyses({ max = 20 } = {}) {
  const user = requireUser();
  const snapshot = await getDocs(query(analysesRef(user.uid), orderBy("createdAtMs", "desc"), limit(max)));
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Neueste gespeicherte Empfehlung (mit `id`) oder null. */
export async function latestAnalysis() {
  const [latest] = await listAnalyses({ max: 1 });
  return latest ?? null;
}

/**
 * Setzt das manuelle Häkchen eines Plantags: { status: "done"|"skipped"|null, extra: true|false|null }.
 * null entfernt die manuelle Angabe (zurück zur Automatik).
 */
export async function setPlanCheck(analysisId, date, check) {
  const user = requireUser();
  const clean = Object.fromEntries(Object.entries(check).filter(([, v]) => v !== null && v !== undefined));
  const ref = doc(analysesRef(user.uid), analysisId);
  const snapshot = await getDoc(ref);
  const checks = { ...(snapshot.data()?.checks ?? {}) };
  if (Object.keys(clean).length) checks[date] = clean;
  else delete checks[date];
  await setDoc(ref, { checks }, { merge: true });
  return checks;
}

// ---------- Saisonpläne: users/{uid}/plans/{autoId} ----------

function plansRef(uid) {
  return collection(db, "users", uid, "plans");
}

/** Speichert einen Saisonplan. Ältere Pläne bleiben erhalten; angezeigt wird der neueste. */
export async function saveSeasonPlan({ model, mode = null, raceDate, plan }) {
  const user = requireUser();
  const ref = await addDoc(plansRef(user.uid), {
    model,
    mode,
    raceDate,
    plan,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  });
  return ref.id;
}

/** Neuester Saisonplan (mit `id`) oder null. */
export async function latestSeasonPlan() {
  const user = requireUser();
  const snapshot = await getDocs(query(plansRef(user.uid), orderBy("createdAtMs", "desc"), limit(1)));
  return snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}
