// The reranker of the direct route (interim tuning of 2026-10-07, arm R2): Cohere `rerank-v3.5`, behind the Reranker port, over
// the REST client in src/platform/cohere (plain fetch, as the embedder). Only the app's composition root builds it, and only where a
// Cohere key is configured (production); no test reaches the network: they hand the adapter a fake client, or use a fake Reranker.
import { createCohereRestClient, type CohereRerankRequest, type CohereRerankResponse } from "@/platform/cohere/restClient";
import { RerankError, type Reranker } from "../application/ports";
import { vendorFailureOf } from "./cohereEmbedder";

/** The rerank model of the direct route: the one the experiment measured. */
export const RERANK_MODEL = "rerank-v3.5";

/** The part of Cohere's v2 client the adapter calls: tests pass a fake. */
export interface CohereRerankClient {
  v2: {
    rerank(request: CohereRerankRequest, options: { abortSignal: AbortSignal; maxRetries: number }): PromiseLike<CohereRerankResponse>;
  };
}

export interface CohereRerankerOptions {
  apiKey: string;
  /** For tests. By default the real client is created on the first call. */
  client?: CohereRerankClient;
  model?: string;
}

/**
 * Asks the model how relevant each provider's search text is to the question. Whatever goes wrong, the error that leaves is a
 * RerankError holding a code: the vendor's error is dropped whole (no message, no cause, no response body), because it may echo
 * the request, and the question is never stored, logged or audited (AD-3).
 */
export function cohereReranker(options: CohereRerankerOptions): Reranker {
  let client: CohereRerankClient | undefined = options.client;
  const model = options.model ?? RERANK_MODEL;
  return {
    model,
    async rerank({ query, documents, signal }) {
      let response;
      try {
        client ??= createCohereRestClient({ apiKey: options.apiKey });
        // No retries: the search's time is short, and the use case falls back to the similarity ranking on any failure.
        response = await client.v2.rerank({ model, query, documents: [...documents] }, { abortSignal: signal, maxRetries: 0 });
      } catch (error) {
        throw signal.aborted ? new RerankError("aborted") : new RerankError("rerank_failed", vendorFailureOf(error));
      }
      const results = (response.results ?? []).filter((r) => Number.isInteger(r.index) && r.index >= 0 && r.index < documents.length && Number.isFinite(r.relevanceScore));
      if (results.length === 0 && documents.length > 0) throw new RerankError("rerank_failed");
      return { results: results.map((r) => ({ index: r.index, relevance: r.relevanceScore })) };
    },
  };
}
