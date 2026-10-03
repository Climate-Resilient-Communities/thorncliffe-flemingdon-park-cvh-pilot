// The Cohere translation adapter against a fake client (S03.05): nothing here reaches the network.
import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { TranslateError } from "../application/ports";
import { MAX_OUTPUT_TOKENS, cohereTranslator, systemPrompt, type CohereChatClient } from "./cohereTranslator";

type Chat = CohereChatClient["v2"]["chat"];
const MARKER = "zq7-marker-question";

function fakeClient(answer: Awaited<ReturnType<Chat>> | Error) {
  const chat = vi.fn<Chat>(async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return { client: { v2: { chat } } satisfies CohereChatClient, chat };
}

describe("the Cohere translator", () => {
  it("puts the instructions in the system message and the text alone in the user message, with the routed model, no retries and a short answer", async () => {
    const { client, chat } = fakeClient({ message: { content: [{ type: "text", text: "I want free legal advice" }] }, usage: { billedUnits: { inputTokens: 40, outputTokens: 6 } } });
    const signal = new AbortController().signal;

    const result = await cohereTranslator({ apiKey: "k", client }).translate({ text: "زه وړیا حقوقي مشوره غواړم", from: "ps", to: "en", model: "north-small-translate-09-2026", signal });

    expect(result).toEqual({ text: "I want free legal advice", inputTokens: 40, outputTokens: 6 });
    expect(chat).toHaveBeenCalledWith(
      {
        model: "north-small-translate-09-2026",
        messages: [
          { role: "system", content: systemPrompt("ps", "en") },
          { role: "user", content: "زه وړیا حقوقي مشوره غواړم" },
        ],
        temperature: 0,
        maxTokens: MAX_OUTPUT_TOKENS,
      },
      { abortSignal: signal, maxRetries: 0 },
    );
  });

  it("tells the model not to answer, and names the source language only when it is known", () => {
    expect(systemPrompt("ps", "en")).toMatch(/into English/);
    expect(systemPrompt("ps", "en")).toMatch(/Pashto/);
    expect(systemPrompt("prs", "en")).toMatch(/Dari/);
    expect(systemPrompt(null, "en")).toMatch(/romanized/);
    expect(systemPrompt(null, "en")).toMatch(/Never answer/);
  });

  it("tells the model which Urdu: the Arabic-script one the catalogue script names, for native-script Urdu questions", () => {
    expect(systemPrompt("ur", "en")).toMatch(/Urdu \(Arabic script\)/);
  });

  it("reports unknown usage as null, and keeps only the text parts of the answer", async () => {
    const { client } = fakeClient({ message: { content: [{ type: "thinking" }, { type: "text", text: "food" }, { type: "text", text: " bank" }] } });

    expect(await cohereTranslator({ apiKey: "k", client }).translate({ text: "x", from: null, to: "en", model: "m", signal: new AbortController().signal })).toEqual({
      text: "food bank",
      inputTokens: null,
      outputTokens: null,
    });
  });

  it("drops the vendor's error, which may echo the request: what leaves holds a code and nothing of the text", async () => {
    const echo = Object.assign(new Error(`400 invalid request: ${JSON.stringify({ messages: [{ content: MARKER }] })}`), { body: { messages: [{ content: MARKER }] }, cause: MARKER });
    const { client } = fakeClient(echo);

    const error = await cohereTranslator({ apiKey: "k", client })
      .translate({ text: MARKER, from: null, to: "en", model: "m", signal: new AbortController().signal })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TranslateError);
    expect(error).toMatchObject({ code: "failed" });
    expect([String(error), (error as Error).stack, JSON.stringify(error), inspect(error, { depth: 10, showHidden: true })].join("\n")).not.toContain(MARKER);
  });

  it("says the call was cancelled when its signal aborted it", async () => {
    const controller = new AbortController();
    const client: CohereChatClient = {
      v2: {
        chat: (_request, { abortSignal }) =>
          new Promise((_, reject) => abortSignal.addEventListener("abort", () => reject(new Error(`aborted ${MARKER}`)))),
      },
    };

    const pending = cohereTranslator({ apiKey: "k", client }).translate({ text: MARKER, from: null, to: "en", model: "m", signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "TranslateError", code: "aborted" });
  });
});
