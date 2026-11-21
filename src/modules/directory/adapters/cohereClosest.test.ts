import { describe, expect, it, vi } from "vitest";
import { ClosestError } from "../application/ports";
import { CLOSEST_MODEL, cohereClosest, type CohereClosestClient } from "./cohereClosest";

const answer = (text: string) => ({ message: { content: [{ type: "text", text }] }, usage: { billedUnits: { inputTokens: 1500, outputTokens: 12 } } });

describe("cohereClosest (session 2, #3)", () => {
  it("sends the prompt at temperature 0 with a short answer, no retries, and returns the text and the billed tokens", async () => {
    const chat = vi.fn(async () => answer('{"ids": ["M007"]}'));
    const client: CohereClosestClient = { v2: { chat } };
    const signal = new AbortController().signal;
    const out = await cohereClosest({ apiKey: "k", client }).pick({ prompt: "the prompt", signal });

    expect(out).toEqual({ text: '{"ids": ["M007"]}', tokens: 1512 });
    expect(chat).toHaveBeenCalledWith({ model: CLOSEST_MODEL, messages: [{ role: "user", content: "the prompt" }], temperature: 0, maxTokens: 60 }, { abortSignal: signal, maxRetries: 0 });
  });

  it("drops the vendor's error whole: a code and how the call failed, never its message", async () => {
    const client: CohereClosestClient = { v2: { chat: async () => Promise.reject(Object.assign(new Error("echo: no puedo pagar"), { statusCode: 429 })) } };
    const error = await cohereClosest({ apiKey: "k", client }).pick({ prompt: "p", signal: new AbortController().signal }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClosestError);
    expect((error as ClosestError).code).toBe("closest_failed");
    expect((error as Error).message).not.toMatch(/pagar/);
  });

  it("says aborted when the caller cut the call", async () => {
    const controller = new AbortController();
    controller.abort();
    const client: CohereClosestClient = { v2: { chat: async () => Promise.reject(new Error("aborted")) } };
    const error = await cohereClosest({ apiKey: "k", client }).pick({ prompt: "p", signal: controller.signal }).catch((e: unknown) => e);
    expect((error as ClosestError).code).toBe("aborted");
  });
});
