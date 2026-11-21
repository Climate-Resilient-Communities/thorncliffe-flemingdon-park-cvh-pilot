// The "closest matches" model (session 2, #3): Cohere Command A over the REST client in src/platform/cohere (plain fetch, as the
// embedder and the reranker). Only the app's composition root builds it, and only where a Cohere key is configured; no test reaches
// the network: they hand the adapter a fake client, or use a fake ClosestPicker.
import { createCohereRestClient, type CohereChatRequest, type CohereChatResponse } from "@/platform/cohere/restClient";
import { ClosestError, type ClosestPicker } from "../application/ports";
import { vendorFailureOf } from "./cohereEmbedder";

/** The model the experiment of 2026-11-21 measured (domain/closestMatches.ts). */
export const CLOSEST_MODEL = "command-a-03-2025";

/** The part of Cohere's v2 client the adapter calls: tests pass a fake. */
export interface CohereClosestClient {
  v2: {
    chat(request: CohereChatRequest, options: { abortSignal: AbortSignal; maxRetries: number }): PromiseLike<CohereChatResponse>;
  };
}

export interface CohereClosestOptions {
  apiKey: string;
  /** For tests. By default the real client is created on the first call. */
  client?: CohereClosestClient;
  model?: string;
}

/**
 * Sends the prompt, at temperature 0 and with a short answer: a list of ids. Whatever goes wrong, the error that leaves is a
 * ClosestError holding a code: the vendor's error is dropped whole (no message, no cause, no body), because it may echo the
 * question, and the question is never stored, logged or audited (AD-3).
 */
export function cohereClosest(options: CohereClosestOptions): ClosestPicker {
  let client: CohereClosestClient | undefined = options.client;
  const model = options.model ?? CLOSEST_MODEL;
  return {
    model,
    async pick({ prompt, signal }) {
      let response;
      try {
        client ??= createCohereRestClient({ apiKey: options.apiKey });
        response = await client.v2.chat({ model, messages: [{ role: "user", content: prompt }], temperature: 0, maxTokens: 60 }, { abortSignal: signal, maxRetries: 0 });
      } catch (error) {
        throw signal.aborted ? new ClosestError("aborted") : new ClosestError("closest_failed", vendorFailureOf(error));
      }
      const text = (response.message?.content ?? []).map((part) => part.text ?? "").join("");
      const billed = response.usage?.billedUnits;
      const tokens = billed && (billed.inputTokens !== undefined || billed.outputTokens !== undefined) ? (billed.inputTokens ?? 0) + (billed.outputTokens ?? 0) : null;
      return { text, tokens };
    },
  };
}
