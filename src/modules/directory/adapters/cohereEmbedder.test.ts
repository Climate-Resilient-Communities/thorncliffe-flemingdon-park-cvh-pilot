// The Cohere adapter against a fake client: nothing here reaches the network.
import { describe, expect, it, vi } from "vitest";
import { cohereEmbedder, type CohereEmbedClient } from "./cohereEmbedder";

type Embed = CohereEmbedClient["v2"]["embed"];

function fakeClient(answer: Awaited<ReturnType<Embed>> | Error) {
  const embed = vi.fn<Embed>(async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return { client: { v2: { embed } } satisfies CohereEmbedClient, embed };
}

describe("the Cohere embedder", () => {
  it("embeds the texts as documents, as floats, with the release's model, and reports the billed tokens", async () => {
    const { client, embed } = fakeClient({ embeddings: { float: [[0.1, 0.2], [0.3, 0.4]] }, meta: { billedUnits: { inputTokens: 42 } } });
    const embedder = cohereEmbedder({ apiKey: "test-key", model: "embed-v4.0", client });
    const signal = new AbortController().signal;

    const result = await embedder.embedDocuments(["a", "b"], { signal });

    expect(embedder.model).toBe("embed-v4.0");
    expect(result).toEqual({ vectors: [[0.1, 0.2], [0.3, 0.4]], tokens: 42 });
    expect(embed).toHaveBeenCalledWith({ model: "embed-v4.0", texts: ["a", "b"], inputType: "search_document", embeddingTypes: ["float"] }, { abortSignal: signal, maxRetries: 0 });
  });

  it("says the tokens are unknown when the vendor does not bill any", async () => {
    const { client } = fakeClient({ embeddings: { float: [[1]] } });

    expect((await cohereEmbedder({ apiKey: "k", model: "m", client }).embedDocuments(["a"], { signal: new AbortController().signal })).tokens).toBeNull();
  });

  it("fails when the answer has no float vectors, and when the call fails", async () => {
    const signal = new AbortController().signal;
    const none = cohereEmbedder({ apiKey: "k", model: "m", client: fakeClient({ embeddings: {} }).client });
    const down = cohereEmbedder({ apiKey: "k", model: "m", client: fakeClient(new Error("503")).client });

    await expect(none.embedDocuments(["a"], { signal })).rejects.toThrow(/no float vectors/);
    await expect(down.embedDocuments(["a"], { signal })).rejects.toThrow("503");
  });

  it("loads the vendor's library only when it first embeds, never when it is made", () => {
    expect(() => cohereEmbedder({ apiKey: "k", model: "m" })).not.toThrow();
  });
});
