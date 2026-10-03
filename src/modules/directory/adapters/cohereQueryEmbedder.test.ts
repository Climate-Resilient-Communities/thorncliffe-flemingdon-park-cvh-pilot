// The question side of the Cohere adapter against a fake client: nothing here reaches the network (S03.04).
import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { QueryEmbedError } from "../application/ports";
import { cohereQueryEmbedder, type CohereEmbedClient } from "./cohereEmbedder";

type Embed = CohereEmbedClient["v2"]["embed"];

function fakeClient(answer: Awaited<ReturnType<Embed>> | Error) {
  const embed = vi.fn<Embed>(async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return { client: { v2: { embed } } satisfies CohereEmbedClient, embed };
}

const QUESTION = "unique-question-text-4711";

describe("the Cohere query embedder", () => {
  it("embeds the question as a query, as floats, with the model and size it is given, without retries, and reports the billed tokens", async () => {
    const { client, embed } = fakeClient({ embeddings: { float: [[0.1, 0.2]] }, meta: { billedUnits: { inputTokens: 5 } } });
    const signal = new AbortController().signal;

    const result = await cohereQueryEmbedder({ apiKey: "k", client }).embedQuery({ text: "a lawyer", model: "embed-v4.0", dims: null, signal });

    expect(result).toEqual({ vector: [0.1, 0.2], tokens: 5 });
    expect(embed).toHaveBeenCalledWith({ model: "embed-v4.0", texts: ["a lawyer"], inputType: "search_query", embeddingTypes: ["float"] }, { abortSignal: signal, maxRetries: 0 });
  });

  it("asks for the release's vector size when it recorded one", async () => {
    const { client, embed } = fakeClient({ embeddings: { float: [[1]] } });

    const result = await cohereQueryEmbedder({ apiKey: "k", client }).embedQuery({ text: "a", model: "m", dims: 512, signal: new AbortController().signal });

    expect(embed).toHaveBeenCalledWith(expect.objectContaining({ outputDimension: 512 }), expect.anything());
    expect(result.tokens).toBeNull();
  });

  it("drops the vendor's error, which may echo the request: what leaves holds a code and nothing of the question", async () => {
    const echo = Object.assign(new Error(`400 invalid request: ${JSON.stringify({ texts: [QUESTION] })}`), { body: { texts: [QUESTION] }, cause: QUESTION });
    const { client } = fakeClient(echo);

    const error = await cohereQueryEmbedder({ apiKey: "k", client }).embedQuery({ text: QUESTION, model: "m", dims: null, signal: new AbortController().signal }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(QueryEmbedError);
    expect(error).toMatchObject({ code: "embed_failed" });
    expect([(error as Error).message, String((error as Error).stack), JSON.stringify(error), inspect(error, { depth: 10, showHidden: true })].join("\n")).not.toContain(QUESTION);
    expect((error as Error).cause).toBeUndefined();
  });

  describe("tells how the vendor's call failed, from its HTTP status alone", () => {
    const failure = async (thrown: unknown) => {
      const client = { v2: { embed: vi.fn<Embed>(() => Promise.reject(thrown)) } } satisfies CohereEmbedClient;
      return (await cohereQueryEmbedder({ apiKey: "k", client }).embedQuery({ text: QUESTION, model: "m", dims: null, signal: new AbortController().signal }).catch((e: unknown) => e)) as QueryEmbedError;
    };
    const status = (code: number, where: "statusCode" | "status" = "statusCode") => Object.assign(new Error(`${code} ${QUESTION}`), { [where]: code, body: { message: `You are past the per-month limit: ${QUESTION}` } });

    it.each([
      ["a 429 (a monthly limit and a per-minute one look the same by status)", status(429), "limited"],
      ["a 401", status(401), "auth"],
      ["a 403, whichever property the SDK puts it in", status(403, "status"), "auth"],
      ["a 500", status(500), "unavailable"],
      ["a 503", status(503, "status"), "unavailable"],
      ["a 400", status(400), "other"],
      ["a 404", status(404), "other"],
      ["a network failure (fetch's TypeError)", new TypeError("fetch failed"), "unavailable"],
      ["a timeout of the SDK", Object.assign(new Error("timed out"), { name: "CohereTimeoutError" }), "unavailable"],
      ["a socket code", Object.assign(new Error("x"), { code: "ECONNRESET" }), "unavailable"],
      ["an error with no status that is not a network failure", new Error("the SDK did not load"), "other"],
      ["something that is not an error", "a string", "other"],
    ])("says %s is %s", async (_name, thrown, vendor) => {
      const error = await failure(thrown);

      expect(error).toBeInstanceOf(QueryEmbedError);
      expect(error).toMatchObject({ code: "embed_failed", vendor });
      // Only the status was read: the vendor's words (a body that says "per-month") and the question stay out of what leaves.
      expect([(error as Error).message, JSON.stringify(error), inspect(error, { depth: 10, showHidden: true })].join("\n")).not.toContain(QUESTION);
    });

    it("gives no vendor class to an aborted call, nor to an answer with no vector", async () => {
      const controller = new AbortController();
      controller.abort();
      const aborted = await cohereQueryEmbedder({ apiKey: "k", client: fakeClient(status(500)).client })
        .embedQuery({ text: "a", model: "m", dims: null, signal: controller.signal })
        .catch((e: unknown) => e);
      const empty = await cohereQueryEmbedder({ apiKey: "k", client: fakeClient({ embeddings: {} }).client })
        .embedQuery({ text: "a", model: "m", dims: null, signal: new AbortController().signal })
        .catch((e: unknown) => e);

      expect(aborted).toMatchObject({ code: "aborted" });
      expect((aborted as QueryEmbedError).vendor).toBeUndefined();
      expect(empty).toMatchObject({ code: "embed_failed" });
      expect((empty as QueryEmbedError).vendor).toBeUndefined();
    });
  });

  it("says aborted when the call was cancelled, and failed when the answer has no vector", async () => {
    const controller = new AbortController();
    const { client } = fakeClient(new Error("aborted"));
    controller.abort();

    await expect(cohereQueryEmbedder({ apiKey: "k", client }).embedQuery({ text: "a", model: "m", dims: null, signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    await expect(
      cohereQueryEmbedder({ apiKey: "k", client: fakeClient({ embeddings: {} }).client }).embedQuery({ text: "a", model: "m", dims: null, signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "embed_failed" });
  });

  it("loads the vendor's library only when it first embeds, never when it is made", () => {
    expect(() => cohereQueryEmbedder({ apiKey: "k" })).not.toThrow();
  });
});
