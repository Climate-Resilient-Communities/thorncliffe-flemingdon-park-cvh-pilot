// Cohere's REST API v2 over plain `fetch` (AD-10, AD-15). It replaces the vendor's SDK (cohere-ai), whose synchronous
// evaluation took about 2.5 s of a cold serverless start, in front of the first search's clock. The shapes are the SDK's own
// (camelCase request and response, the SDK's `statusCode` and `body` on an error), so the adapters in directory and
// translation and their fake clients did not change. Server only; tests pass `fetch`, nothing here reaches the network on its own.

const DEFAULT_BASE_URL = "https://api.cohere.com";
/** The SDK's own default; callers hand an AbortSignal with the budget they really have. */
const DEFAULT_TIMEOUT_MS = 60_000;

export interface CohereEmbedRequest {
  model: string;
  texts: string[];
  inputType: "search_document" | "search_query";
  embeddingTypes: ["float"];
  outputDimension?: number;
}
export interface CohereEmbedResponse {
  embeddings: { float?: number[][] };
  meta?: { billedUnits?: { inputTokens?: number } };
}
export interface CohereChatRequest {
  model: string;
  messages: { role: "system" | "user"; content: string }[];
  temperature: number;
  maxTokens: number;
}
export interface CohereChatResponse {
  message?: { content?: { type: string; text?: string }[] };
  usage?: { billedUnits?: { inputTokens?: number; outputTokens?: number } };
}
export interface CohereCallOptions {
  abortSignal: AbortSignal;
  /** Accepted for the SDK's shape; this client never retries (the callers decide, and a retry would hide the time it takes). */
  maxRetries?: number;
}

/** A non-2xx answer: the status and the parsed body (the adapters read `message` of it to tell a monthly limit from a transient one). */
export class CohereHttpError extends Error {
  readonly statusCode: number;
  readonly body: unknown;
  constructor(statusCode: number, body: unknown) {
    // Not the body: it may repeat the request.
    super(`Cohere answered ${statusCode}`);
    this.name = "CohereHttpError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

/** The call ran past its own deadline (the adapters classify this name as the vendor being unreachable). */
export class CohereTimeoutError extends Error {
  constructor() {
    super("The Cohere call timed out");
    this.name = "CohereTimeoutError";
  }
}

export interface CohereRestClient {
  v2: {
    embed(request: CohereEmbedRequest, options: CohereCallOptions): Promise<CohereEmbedResponse>;
    chat(request: CohereChatRequest, options: CohereCallOptions): Promise<CohereChatResponse>;
  };
}

export interface CohereRestClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** For tests. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

type Json = Record<string, unknown>;

function record(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function billed(value: unknown): { inputTokens?: number; outputTokens?: number } | undefined {
  const units = record(record(value)?.billed_units);
  if (!units) return undefined;
  return { inputTokens: num(units.input_tokens), outputTokens: num(units.output_tokens) };
}

export function createCohereRestClient(options: CohereRestClientOptions): CohereRestClient {
  const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function post(path: string, payload: Json, signal: AbortSignal): Promise<Json> {
    const deadline = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json", Accept: "application/json", "X-Client-Name": "cvh-pilot" },
        body: JSON.stringify(payload),
        signal: AbortSignal.any([signal, deadline]),
      });
    } catch (error) {
      if (deadline.aborted && !signal.aborted) throw new CohereTimeoutError();
      throw error;
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      if (deadline.aborted && !signal.aborted) throw new CohereTimeoutError();
      if (signal.aborted) throw error;
      body = undefined;
    }
    if (!response.ok) throw new CohereHttpError(response.status, body);
    return record(body) ?? {};
  }

  return {
    v2: {
      async embed(request, { abortSignal }) {
        const json = await post(
          "/v2/embed",
          {
            model: request.model,
            texts: request.texts,
            input_type: request.inputType,
            embedding_types: request.embeddingTypes,
            ...(request.outputDimension === undefined ? {} : { output_dimension: request.outputDimension }),
          },
          abortSignal,
        );
        const embeddings = record(json.embeddings);
        return {
          embeddings: { float: Array.isArray(embeddings?.float) ? (embeddings.float as number[][]) : undefined },
          meta: { billedUnits: billed(json.meta) },
        };
      },
      async chat(request, { abortSignal }) {
        const json = await post(
          "/v2/chat",
          { model: request.model, messages: request.messages, temperature: request.temperature, max_tokens: request.maxTokens, stream: false },
          abortSignal,
        );
        const message = record(json.message);
        return {
          message: { content: Array.isArray(message?.content) ? (message.content as { type: string; text?: string }[]) : undefined },
          usage: { billedUnits: billed(json.usage) },
        };
      },
    },
  };
}
