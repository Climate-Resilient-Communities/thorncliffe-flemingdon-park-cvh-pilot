// The Cohere adapter as alerts use it (S04.02): room for a whole alert, the prompt's version, and vendor language names that
// stop at the adapter. Nothing here reaches the network. (The adapter's tests for questions are in cohereTranslator.test.ts.)
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { LANG_CODES } from "@/contracts/lang";
import { ALERT_MAX_OUTPUT_TOKENS } from "../domain/alertTranslation";
import { MAX_OUTPUT_TOKENS, PROMPT_VERSION, cohereTranslator, systemPrompt, type CohereChatClient } from "./cohereTranslator";

type Chat = CohereChatClient["v2"]["chat"];
const answer = { message: { content: [{ type: "text", text: "x" }] }, usage: { billedUnits: { inputTokens: 1, outputTokens: 1 } } };

function client() {
  const chat = vi.fn<Chat>(async () => answer);
  return { client: { v2: { chat } } satisfies CohereChatClient, chat };
}

describe("the Cohere translator for alerts", () => {
  it("asks for as many tokens as the caller allows, so a whole alert in Bengali or Tamil is not cut off", async () => {
    const { client: fake, chat } = client();
    const signal = new AbortController().signal;

    await cohereTranslator({ apiKey: "k", client: fake }).translate({ text: "The elevator is out of service.", from: "en", to: "ta", model: "m", signal, maxOutputTokens: ALERT_MAX_OUTPUT_TOKENS });

    expect(chat.mock.calls[0]![0].maxTokens).toBe(ALERT_MAX_OUTPUT_TOKENS);
    expect(ALERT_MAX_OUTPUT_TOKENS).toBeGreaterThan(MAX_OUTPUT_TOKENS);
  });

  it("keeps the short answer for a question when the caller does not say", async () => {
    const { client: fake, chat } = client();

    await cohereTranslator({ apiKey: "k", client: fake }).translate({ text: "x", from: "ps", to: "en", model: "m", signal: new AbortController().signal });

    expect(chat.mock.calls[0]![0].maxTokens).toBe(MAX_OUTPUT_TOKENS);
  });

  it("names the languages to the model in words and sends the text alone as the user message: no LangCode reaches the vendor", async () => {
    for (const lang of LANG_CODES.filter((code) => code !== "en")) {
      const { client: fake, chat } = client();
      await cohereTranslator({ apiKey: "k", client: fake }).translate({ text: "Elevator out of service.", from: "en", to: lang, model: "m", signal: new AbortController().signal });

      const request = chat.mock.calls[0]![0];
      expect(request.messages).toEqual([
        { role: "system", content: systemPrompt("en", lang) },
        { role: "user", content: "Elevator out of service." },
      ]);
      // "ur", "prs", "zh-Hant" and the rest are the app's codes; the prompt says Urdu, Persian (Dari) and Chinese (Traditional).
      expect(request.messages[0]!.content).not.toMatch(new RegExp(`(^|[^A-Za-z-])${lang}($|[^A-Za-z-])`));
    }
  });

  it("is told the target by a name that tells Dari from Pashto, since a model asked for Afghan wording answers in Pashto", () => {
    expect(systemPrompt("en", "prs")).toMatch(/Persian \(Dari/);
    expect(systemPrompt("en", "ps")).toMatch(/Pashto/);
  });

  it("pins the prompt: a different prompt or language name needs a new PROMPT_VERSION, since the cache key carries it", () => {
    const prompts = LANG_CODES.map((lang) => systemPrompt("en", lang)).join("\n---\n");
    const fingerprint = createHash("sha256").update(prompts).digest("hex").slice(0, 16);

    // When this fails, the prompt (or LANGUAGE_NAMES) changed: bump PROMPT_VERSION in cohereTranslator.ts and put the new fingerprint here.
    expect({ version: PROMPT_VERSION, fingerprint }).toEqual({ version: "1", fingerprint: "2e30411d1e14c188" });
  });
});
