// Firebase-Web-Konfiguration.
//
// Diese Werte sind ÖFFENTLICH und dürfen ins Repository: Sie identifizieren nur das
// Firebase-Projekt. Der Schutz der Daten erfolgt über Firebase Authentication und die
// Firestore Security Rules (siehe firestore.rules), nicht über Geheimhaltung dieser Werte.
//
// Werte findest du in der Firebase-Konsole unter
// Projekteinstellungen → Allgemein → Meine Apps → Web-App → SDK-Einrichtung (Config).

export const firebaseConfig = {
  apiKey: "AIzaSyCW6FRqZo2db09gAS3QB7nmTUmyrZ2N0sg",
  authDomain: "tpa-schiller.firebaseapp.com",
  projectId: "tpa-schiller",
  storageBucket: "tpa-schiller.firebasestorage.app",
  messagingSenderId: "41090489836",
  appId: "1:41090489836:web:1f0c80903b4dca93f074c9",
  // measurementId wird nicht gebraucht (kein Google Analytics).
};

/** true, sobald die Platzhalter durch echte Werte ersetzt wurden. */
export function isFirebaseConfigured() {
  return !Object.values(firebaseConfig).some((value) => String(value).includes("DEIN"));
}
