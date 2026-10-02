// The embedding model of the directory (AD-11, AD-15): Cohere, behind the Embedder port. The vendor's names (`input_type`,
// `search_document`, billed units) stop here. Only the app's composition root builds it, and only where a Cohere key is
// configured (production); no test reaches the network: they hand the adapter a fake client, or use a fake Embedder.
import type { EmbeddedTexts, Embedder } from "../application/ports";

/** The part of Cohere's v2 client the adapter calls: tests pass a fake. */
export interface CohereEmbedClient {
  v2: {
    embed(
      request: { model: string; texts: string[]; inputType: "search_document"; embeddingTypes: ["float"]; outputDimension?: number },
      options: { abortSignal: AbortSignal; maxRetries: number },
    ): PromiseLike<{ embeddings: { float?: number[][] }; meta?: { billedUnits?: { inputTokens?: number } } }>;
  };
}

export interface CohereEmbedderOptions {
  apiKey: string;
  model: string;
  /** Asks for vectors of this many numbers; left out, the model's own default applies (and the embedding config says so). */
  dims?: number;
  /** For tests. By default the real client is created on the first call, so importing the module loads nothing. */
  client?: CohereEmbedClient;
}

export function cohereEmbedder(options: CohereEmbedderOptions): Embedder {
  let client: CohereEmbedClient | undefined = options.client;
  return {
    model: options.model,
    config: { model: options.model, inputType: "search_document", embeddingType: "float", dims: options.dims ?? null },
    async embedDocuments(texts, { signal }): Promise<EmbeddedTexts> {
      if (!client) {
        const { CohereClient } = await import("cohere-ai");
        client = new CohereClient({ token: options.apiKey }) as unknown as CohereEmbedClient;
      }
      // The job decides whether to try again (and how often): the SDK's own retries would hide the time they take.
      const response = await client.v2.embed(
        { model: options.model, texts, inputType: "search_document", embeddingTypes: ["float"], ...(options.dims === undefined ? {} : { outputDimension: options.dims }) },
        { abortSignal: signal, maxRetries: 0 },
      );
      const vectors = response.embeddings.float;
      if (!vectors) throw new Error("The embedding model returned no float vectors");
      const tokens = response.meta?.billedUnits?.inputTokens;
      return { vectors, tokens: typeof tokens === "number" ? tokens : null };
    },
  };
}
