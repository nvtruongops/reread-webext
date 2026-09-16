/**
 * Local AnkiConnect bridge (http://127.0.0.1:8765).
 * Generates Anki JSON-RPC payloads and syncs vocabulary cards directly to Anki Desktop.
 */

export const ANKI_CONNECT_DEFAULT_URL = "http://127.0.0.1:8765";

/**
 * Builds standard Anki note payload for addNote.
 * @param {Object} options
 * @param {string} options.phrase
 * @param {string} options.meaning
 * @param {string} [options.context]
 * @param {string} [options.deckName="Default"]
 * @param {string} [options.modelName="Basic"]
 * @param {string[]} [options.tags]
 * @returns {Record<string, any>}
 */
export function buildAnkiNotePayload({
  phrase,
  meaning,
  context = "",
  deckName = "Default",
  modelName = "Basic",
  tags = ["reread"],
}) {
  const front = phrase.trim();
  let back = meaning.trim();
  if (context && context.trim().length > 0) {
    back += `<br><br><small><i>${context.trim()}</i></small>`;
  }

  return {
    action: "addNote",
    version: 6,
    params: {
      note: {
        deckName,
        modelName,
        fields: {
          Front: front,
          Back: back,
        },
        options: {
          allowDuplicate: false,
          duplicateScope: "deck",
        },
        tags: Array.isArray(tags) ? tags : ["reread"],
      },
    },
  };
}

/**
 * Sends a request to AnkiConnect via injected transport.
 * @param {Object} options
 * @param {string} options.action AnkiConnect action name
 * @param {Record<string, any>} [options.params] Action parameters
 * @param {string} [options.endpoint=ANKI_CONNECT_DEFAULT_URL] Local endpoint
 * @param {Function|null} [options.transport] HTTP caller function (fetch-like)
 * @returns {Promise<{ ok: boolean, result?: any, error?: string }>}
 */
export async function invokeAnkiConnect({
  action,
  params = {},
  endpoint = ANKI_CONNECT_DEFAULT_URL,
  transport = null,
}) {
  if (typeof transport !== "function") {
    return { ok: false, error: "Transport function required" };
  }

  const payload = {
    action,
    version: 6,
    params,
  };

  try {
    const response = await transport(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    if (data.error) {
      return { ok: false, error: data.error };
    }

    return { ok: true, result: data.result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
