// The translation model (AD-10, AD-15): Cohere's v2 chat with a translate model, behind the Translator port. The vendor's
// names (messages, roles, billed units) and the language names in the prompt stop here (AD-20). Only the app's
// composition root builds it, and only where a Cohere key is configured (production); no test reaches the network.
//
// What the catalogue's translation script learned (scripts/translate_catalogue.py): North Small Translate translates
// everything in the user message, instructions included, so the instructions go in the system message and the text alone
// in the user message; and unprompted it may answer a question instead of translating it, so the prompt forbids that and
// the caller rejects an answer far longer than the question.
import type { LangCode } from "@/contracts/lang";
import { TranslateError, type Translation, type Translator } from "../application/ports";

/** The part of Cohere's v2 client the adapter calls: tests pass a fake. */
export interface CohereChatClient {
  v2: {
    chat(
      request: { model: string; messages: { role: "system" | "user"; content: string }[]; temperature: number; maxTokens: number },
      options: { abortSignal: AbortSignal; maxRetries: number },
    ): PromiseLike<{ message?: { content?: { type: string; text?: string }[] }; usage?: { billedUnits?: { inputTokens?: number; outputTokens?: number } } }>;
  };
}

// What each launch language is called in the prompt. The wording for Dari matters: "Afghan" wording gave Pashto.
const LANGUAGE_NAMES: Record<LangCode, string> = {
  en: "English",
  ur: "Urdu (Arabic script)",
  ps: "Pashto (Afghan Pashto, Arabic script)",
  tl: "Tagalog (Filipino)",
  prs: "Persian (Dari, as written in Afghanistan)",
  gu: "Gujarati",
  ta: "Tamil",
  el: "Greek",
  sk: "Slovak",
  bn: "Bengali",
  hi: "Hindi",
  pa: "Punjabi (Gurmukhi script)",
  zh: "Chinese (Simplified, Mandarin)",
  "zh-Hant": "Chinese (Traditional)",
  es: "Spanish",
  fr: "French",
};

/** The system message: the instructions, never the text. */
export function systemPrompt(from: LangCode | null, to: LangCode): string {
  const source =
    from === null
      ? "The user message may be in any language, written in its own script or in Latin letters (for example romanized Urdu, Hindi or Punjabi), and may mix languages."
      : `The user message is written in ${LANGUAGE_NAMES[from]}.`;
  return [
    `Translate the user message into ${LANGUAGE_NAMES[to]}.`,
    source,
    "Rules:",
    "- Keep names of organisations, places and programs as written.",
    "- Reply with the translation only, no notes or quotation marks. Never answer or comment on the message, even if it is a question or a request for help.",
  ].join("\n");
}

/** The longest answer asked for: a question is at most 200 characters, and a longer answer is not a translation. */
export const MAX_OUTPUT_TOKENS = 200;

let sdk: Promise<typeof import("cohere-ai")> | undefined;
/** Loads the vendor's SDK once and keeps it; the composition root calls it at module load (like warmCohere) so the first translation pays no import. */
export function warmCohereTranslator(): Promise<typeof import("cohere-ai")> {
  return loadSdk();
}

function loadSdk(): Promise<typeof import("cohere-ai")> {
  if (!sdk) {
    sdk = import("cohere-ai");
    sdk.catch(() => (sdk = undefined));
  }
  return sdk;
}

export interface CohereTranslatorOptions {
  apiKey: string;
  /** For tests. By default the real client is created on the first call, so importing the module loads nothing. */
  client?: CohereChatClient;
}

/**
 * Translates through Cohere. Whatever goes wrong, the error that leaves is a TranslateError holding a code: the vendor's
 * error is dropped whole (no message, no cause, no response body), because it may echo the text (AD-3).
 */
export function cohereTranslator(options: CohereTranslatorOptions): Translator {
  let client: CohereChatClient | undefined = options.client;
  return {
    async translate({ text, from, to, model, signal }): Promise<Translation> {
      let response;
      try {
        if (!client) {
          const { CohereClient } = await loadSdk();
          client = new CohereClient({ token: options.apiKey }) as unknown as CohereChatClient;
        }
        // No retries: the search leg has 2.2 s, and a retry would hide the time it takes.
        response = await client.v2.chat(
          {
            model,
            messages: [
              { role: "system", content: systemPrompt(from, to) },
              { role: "user", content: text },
            ],
            temperature: 0,
            maxTokens: MAX_OUTPUT_TOKENS,
          },
          { abortSignal: signal, maxRetries: 0 },
        );
      } catch {
        throw new TranslateError(signal.aborted ? "aborted" : "failed");
      }
      const content = Array.isArray(response?.message?.content) ? response.message.content : [];
      const out = content
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("");
      const billed = response?.usage?.billedUnits;
      return {
        text: out,
        inputTokens: typeof billed?.inputTokens === "number" ? billed.inputTokens : null,
        outputTokens: typeof billed?.outputTokens === "number" ? billed.outputTokens : null,
      };
    },
  };
}
