// The Cohere reranker against a fake client: nothing here reaches the network.
import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { CohereHttpError } from "@/platform/cohere/restClient";
import { RerankError } from "../application/ports";
import { cohereReranker, type CohereRerankClient } from "./cohereReranker";

type Rerank = CohereRerankClient["v2"]["rerank"];
const QUESTION = "unique-question-text-4712";

function fakeClient(answer: Awaited<ReturnType<Rerank>> | Error) {
  const rerank = vi.fn<Rerank>(async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return { client: { v2: { rerank } } satisfies CohereRerankClient, rerank };
}

describe("the Cohere reranker", () => {
  it("asks rerank-v3.5 about the documents, without retries, and gives each one's relevance by its index", async () => {
    const { client, rerank } = fakeClient({ results: [{ index: 1, relevanceScore: 0.4 }, { index: 0, relevanceScore: 0.02 }] });
    const signal = new AbortController().signal;

    const out = await cohereReranker({ apiKey: "k", client }).rerank({ query: "q", documents: ["a", "b"], signal });

    expect(out).toEqual({ results: [{ index: 1, relevance: 0.4 }, { index: 0, relevance: 0.02 }] });
    expect(rerank).toHaveBeenCalledWith({ model: "rerank-v3.5", query: "q", documents: ["a", "b"] }, { abortSignal: signal, maxRetries: 0 });
  });

  it("tells a 429 as limited and drops the vendor's error, which may echo the question", async () => {
    const { client } = fakeClient(new CohereHttpError(429, { message: `too many: ${QUESTION}` }));
    const error = await cohereReranker({ apiKey: "k", client })
      .rerank({ query: QUESTION, documents: ["a"], signal: new AbortController().signal })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RerankError);
    expect(error).toMatchObject({ code: "rerank_failed", vendor: "limited" });
    expect(inspect(error, { depth: 5 })).not.toContain(QUESTION);
  });

  it("says aborted for a call cancelled by its signal, and fails an answer with no usable result", async () => {
    const controller = new AbortController();
    controller.abort();
    const aborted = fakeClient(new Error("aborted"));
    await expect(cohereReranker({ apiKey: "k", client: aborted.client }).rerank({ query: "q", documents: ["a"], signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });

    const empty = fakeClient({ results: [{ index: 7, relevanceScore: 0.5 }] });
    await expect(cohereReranker({ apiKey: "k", client: empty.client }).rerank({ query: "q", documents: ["a"], signal: new AbortController().signal })).rejects.toMatchObject({ code: "rerank_failed" });
  });
});
