// The embedding model of the directory (AD-11, AD-15): Cohere, behind the Embedder port. The vendor's names (`input_type`,
// `search_document`, billed units) stop here (the REST client in src/platform/cohere speaks them). Only the app's composition root builds it, and only where a Cohere key is
// configured (production); no test reaches the network: they hand the adapter a fake client, or use a fake Embedder.
import { createCohereRestClient } from "@/platform/cohere/restClient";
import { QueryEmbedError, type EmbeddedTexts, type Embedder, type QueryEmbedder, type QueryEmbedVendorFailure } from "../application/ports";

/** The part of Cohere's v2 client the adapter calls: tests pass a fake. */
export interface CohereEmbedClient {
  v2: {
    embed(
      request: { model: string; texts: string[]; inputType: "search_document" | "search_query"; embeddingTypes: ["float"]; outputDimension?: number },
      options: { abortSignal: AbortSignal; maxRetries: number },
    ): PromiseLike<{ embeddings: { float?: number[][] }; meta?: { billedUnits?: { inputTokens?: number } } }>;
  };
}

export interface CohereEmbedderOptions {
  apiKey: string;
  model: string;
  /** Asks for vectors of this many numbers; left out, the model's own default applies (and the embedding config says so). */
  dims?: number;
  /** For tests. By default a client over Cohere's REST API (plain fetch) is created on the first call. */
  client?: CohereEmbedClient;
}

export function cohereEmbedder(options: CohereEmbedderOptions): Embedder {
  let client: CohereEmbedClient | undefined = options.client;
  return {
    model: options.model,
    config: { model: options.model, inputType: "search_document", embeddingType: "float", dims: options.dims ?? null },
    async embedDocuments(texts, { signal }): Promise<EmbeddedTexts> {
      client ??= createCohereRestClient({ apiKey: options.apiKey });
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

export interface CohereQueryEmbedderOptions {
  apiKey: string;
  /** For tests. By default the real client is created on the first call. */
  client?: CohereEmbedClient;
}

/** The vendor's HTTP status, wherever the client put it. Nothing else of the error is read: its message may repeat the request. */
function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const e = error as { statusCode?: unknown; status?: unknown };
  for (const value of [e.statusCode, e.status]) if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

/**
 * How a failed call of the vendor is told to ops, from its status alone (see QueryEmbedVendorFailure). Without a status, a
 * timeout or a network failure (fetch's TypeError, the client's timeout, a socket code) is the vendor being unreachable and
 * anything else (a bug) is `other`.
 */
export function vendorFailureOf(error: unknown): QueryEmbedVendorFailure {
  const status = statusOf(error);
  if (status === 429) return "limited";
  if (status === 401 || status === 403) return "auth";
  if (status !== null) return status >= 500 ? "unavailable" : "other";
  const e = error as { name?: unknown; code?: unknown } | null;
  return error instanceof TypeError || e?.name === "CohereTimeoutError" || e?.name === "FetchError" || typeof e?.code === "string" ? "unavailable" : "other";
}

/**
 * Embeds a resident's question as a query (`input_type: search_query`, S03.04). Whatever goes wrong, the error that leaves is
 * a QueryEmbedError holding a code: the vendor's error is dropped whole (no message, no cause, no response body), because
 * it may echo the request, and the question is never stored, logged or audited (AD-3).
 */
export function cohereQueryEmbedder(options: CohereQueryEmbedderOptions): QueryEmbedder {
  let client: CohereEmbedClient | undefined = options.client;
  return {
    async embedQuery({ text, model, dims, signal }) {
      let response;
      try {
        client ??= createCohereRestClient({ apiKey: options.apiKey });
        // No retries: the search has 2.2 s for the whole leg, and a retry would hide the time it takes.
        response = await client.v2.embed(
          { model, texts: [text], inputType: "search_query", embeddingTypes: ["float"], ...(dims === null ? {} : { outputDimension: dims }) },
          { abortSignal: signal, maxRetries: 0 },
        );
      } catch (error) {
        throw signal.aborted ? new QueryEmbedError("aborted") : new QueryEmbedError("embed_failed", vendorFailureOf(error));
      }
      const vector = response.embeddings?.float?.[0];
      if (!vector || vector.length === 0) throw new QueryEmbedError("embed_failed");
      const tokens = response.meta?.billedUnits?.inputTokens;
      return { vector, tokens: typeof tokens === "number" ? tokens : null };
    },
  };
}
