// Gemini-Anbindung (Interactions API) – nur Gerüst.
//
// Doku: https://aistudio.google.com/docs/text-generation
//       https://aistudio.google.com/docs/structured-output
//
// Hinweis kostenloser Tarif: Google darf Eingaben und Antworten zur Verbesserung seiner
// Produkte verwenden. Deshalb nur kompakte, anonyme Trainingszusammenfassungen schicken
// (keine Namen, keine GPS-Spuren, keine Rohdaten-Dumps).

import { getSetting } from "./settings.js";

/**
 * Modellname zentral als Konstante. Stabil und im kostenlosen Tarif verfügbar.
 * Alternative laut Google-Empfehlung für neue Projekte: "gemini-4-hydrogen".
 * Aktuelle Modelle: https://aistudio.google.com/docs/models
 */
export const GEMINI_MODEL = "gemini-3.8-flash";

export const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
export const GEMINI_API_REVISION = "2026-05-20";
export const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

// ---------- Prompts (Entwürfe) ----------

export const SYSTEM_PROMPT_ANALYSE = `Du bist ein erfahrener Ausdauertrainer.
Du bekommst eine kompakte Zusammenfassung meiner letzten Trainingswochen
(Wochenumfang, Intensitätsverteilung, Trends).
Bewerte Belastung und Entwicklung und gib konkrete, vorsichtige Empfehlungen
für die nächsten Trainings. Antworte auf Deutsch.`;
// TODO: Ausgabeformat (JSON-Schema) festlegen und über `schema` mitgeben.

export const SYSTEM_PROMPT_PLAN = `Du bist ein erfahrener Ausdauertrainer.
Erstelle auf Basis der Zusammenfassung und meiner Ziele einen mehrwöchigen Trainingsplan.
Antworte ausschließlich mit JSON im vorgegebenen Schema.`;
// TODO: JSON-Schema für den Plan definieren (PLAN_SCHEMA) und über `schema` mitgeben.

// ---------- API-Aufruf ----------

/**
 * Ruft die Gemini Interactions API direkt aus dem Browser auf.
 * @param {{ system?: string, input: string, schema?: object, maxOutputTokens?: number }} args
 *   schema: optionales JSON-Schema → Gemini antwortet dann mit passendem JSON.
 */
export async function callGemini({ system, input, schema, maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS }) {
  const apiKey = getSetting("geminiApiKey");
  if (!apiKey) throw new Error("Bitte zuerst den Gemini API-Key in den Einstellungen eintragen.");

  // TODO: Aufruf aktivieren, sobald die Analyse-Daten vorliegen. Skizze:
  //
  // const body = {
  //   model: GEMINI_MODEL,
  //   input,
  //   system_instruction: system,
  //   generation_config: { max_output_tokens: maxOutputTokens },
  //   store: false, // zustandslos: keine Interaktion serverseitig vorhalten
  // };
  // if (schema) {
  //   body.response_format = { type: "text", mime_type: "application/json", schema };
  // }
  //
  // const response = await fetch(GEMINI_API_URL, {
  //   method: "POST",
  //   headers: {
  //     "content-type": "application/json",
  //     // Der Key liegt im Browser. Schutz: in der Google Cloud Console auf die eigenen
  //     // Domains (HTTP-Referrer) und die "Generative Language API" beschränken.
  //     "x-goog-api-key": apiKey,
  //     "Api-Revision": GEMINI_API_REVISION,
  //   },
  //   body: JSON.stringify(body),
  // });
  //
  // TODO: Fehler behandeln (400 ungültige Anfrage, 403 Key ungültig/gesperrt,
  //       429 Kontingent des kostenlosen Tarifs erschöpft, Netzwerkfehler)
  // TODO: Text aus den `model_output`-Steps der Antwort (TextContent) zusammensetzen
  // TODO: JSON-Antworten parsen und gegen das erwartete Schema prüfen, bevor sie gespeichert werden
  void system;
  void input;
  void schema;
  void maxOutputTokens;
  throw new Error("TODO: callGemini ist noch nicht umgesetzt.");
}
