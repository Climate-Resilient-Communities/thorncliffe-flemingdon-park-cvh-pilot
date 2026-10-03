// The SDK is imported once, ahead of the first question (S03.04): nothing here reaches the network.
import { describe, expect, it, vi } from "vitest";

const constructed = vi.fn();
const loaded = vi.fn();
vi.mock("cohere-ai", () => {
  loaded();
  return {
    CohereClient: class {
      v2 = { embed: async () => ({ embeddings: { float: [[1, 2]] } }) };
      constructor(options: unknown) {
        constructed(options);
      }
    },
  };
});

describe("warmCohere", () => {
  it("loads the SDK once, however often it is asked, and the first question then pays no import", async () => {
    const { cohereQueryEmbedder, warmCohere } = await import("./cohereEmbedder");

    const first = warmCohere();
    expect(warmCohere()).toBe(first);
    await first;
    expect(loaded).toHaveBeenCalledTimes(1);

    const result = await cohereQueryEmbedder({ apiKey: "k" }).embedQuery({ text: "a", model: "m", dims: null, signal: new AbortController().signal });

    expect(result.vector).toEqual([1, 2]);
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(constructed).toHaveBeenCalledTimes(1);
  });
});
