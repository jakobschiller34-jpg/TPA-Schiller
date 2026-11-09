// Claude-Anbindung (Messages API) – nur Gerüst.
//
// Doku: https://docs.claude.com/en/api/messages

import { getSetting } from "./settings.js";

/** Modellname zentral als Konstante, damit er an einer Stelle geändert werden kann. */
export const CLAUDE_MODEL = "claude-sonnet-5-5";

export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
export const DEFAULT_MAX_TOKENS = 2048;

// ---------- Prompts (Entwürfe) ----------

export const SYSTEM_PROMPT_ANALYSE = `Du bist ein erfahrener Ausdauertrainer.
Du bekommst eine kompakte Zusammenfassung meiner letzten Trainingswochen
(Wochenumfang, Intensitätsverteilung, Trends).
Bewerte Belastung und Entwicklung und gib konkrete, vorsichtige Empfehlungen
für die nächsten Trainings. Antworte auf Deutsch.`;
// TODO: Ausgabeformat (JSON) festlegen und hier beschreiben.

export const SYSTEM_PROMPT_PLAN = `Du bist ein erfahrener Ausdauertrainer.
Erstelle auf Basis der Zusammenfassung und meiner Ziele einen mehrwöchigen Trainingsplan.
Antworte ausschließlich mit JSON im vorgegebenen Schema.`;
// TODO: JSON-Schema für den Plan definieren und im Prompt mitgeben.

// ---------- API-Aufruf ----------

/**
 * Ruft die Claude Messages API direkt aus dem Browser auf.
 * @param {{ system?: string, messages: Array<{role: "user"|"assistant", content: string}>, maxTokens?: number }} args
 */
export async function callClaude({ system, messages, maxTokens = DEFAULT_MAX_TOKENS }) {
  const apiKey = getSetting("anthropicApiKey");
  if (!apiKey) throw new Error("Bitte zuerst den Anthropic API-Key in den Einstellungen eintragen.");

  // TODO: Aufruf aktivieren, sobald die Analyse-Daten vorliegen. Skizze:
  //
  // const response = await fetch(ANTHROPIC_API_URL, {
  //   method: "POST",
  //   headers: {
  //     "content-type": "application/json",
  //     "x-api-key": apiKey,
  //     "anthropic-version": ANTHROPIC_VERSION,
  //     // Pflicht-Header für Aufrufe direkt aus dem Browser (CORS). Anthropic verlangt ihn
  //     // bewusst, weil der API-Key dabei im Browser liegt und von jedem Skript auf der Seite
  //     // gelesen werden könnte. Für diese rein persönliche App ein akzeptierter Kompromiss –
  //     // deshalb in der Anthropic-Konsole unbedingt ein Ausgabelimit setzen.
  //     "anthropic-dangerous-direct-browser-access": "true",
  //   },
  //   body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, system, messages }),
  // });
  //
  // TODO: Fehler behandeln (401 ungültiger Key, 429 Rate-Limit, 529 überlastet, Netzwerkfehler)
  // TODO: Text aus response.content[] zusammensetzen, stop_reason prüfen ("max_tokens"?)
  // TODO: JSON-Antworten gegen das erwartete Schema validieren, bevor sie gespeichert werden
  void system;
  void messages;
  void maxTokens;
  throw new Error("TODO: callClaude ist noch nicht umgesetzt.");
}
