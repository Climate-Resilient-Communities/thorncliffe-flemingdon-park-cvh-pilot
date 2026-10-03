// The adapters of directory and translation over the REST client (src/platform/cohere/restClient.ts) and a fake fetch: the
// request the vendor would get, the answer read back, and the error classes of its failures. Nothing here reaches the network.
import { describe, expect, it } from "vitest";
import { cohereQueryEmbedder } from "@/modules/directory";
import { classifyCohereError, cohereTranslator } from "@/modules/translation";
import { CohereHttpError, CohereTimeoutError, createCohereRestClient } from "@/platform/cohere/restClient";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const signal = () => new AbortController().signal;

function fakeFetch(respond: (body: Record<string, unknown>) => Response) {
  const seen: { url: string; body: Record<string, unknown> }[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    seen.push({ url: String(input), body });
    return respond(body);
  }) as typeof fetch;
  return { seen, fetch: fn };
}

describe("the Cohere adapters over the REST client", () => {
  it("embed a question and translate through a fake fetch", async () => {
    const embedFetch = fakeFetch(() => ok({ embeddings: { float: [[0.5, 0.25]] }, meta: { billed_units: { input_tokens: 3 } } }));
    const embedder = cohereQueryEmbedder({ apiKey: "k", client: createCohereRestClient({ apiKey: "k", fetch: embedFetch.fetch }) });
    expect(await embedder.embedQuery({ text: "food", model: "embed-v4.0", dims: null, signal: signal() })).toEqual({ vector: [0.5, 0.25], tokens: 3 });
    expect(embedFetch.seen[0].body).toMatchObject({ input_type: "search_query", texts: ["food"] });

    const chatFetch = fakeFetch(() => ok({ message: { content: [{ type: "text", text: "comida" }] }, usage: { billed_units: { input_tokens: 9, output_tokens: 1 } } }));
    const translator = cohereTranslator({ apiKey: "k", client: createCohereRestClient({ apiKey: "k", fetch: chatFetch.fetch }) });
    expect(await translator.translate({ text: "food", from: "en", to: "es", model: "north-small-translate", signal: signal() })).toEqual({ text: "comida", inputTokens: 9, outputTokens: 1 });
  });
});

describe("how the REST client's failures are classified", () => {
  it("tells a monthly limit from a transient one, an outage and a bad request, and a timeout as unreachable", () => {
    expect(classifyCohereError(new CohereHttpError(429, { message: "You are past the per-month request limit" }))).toBe("quota");
    expect(classifyCohereError(new CohereHttpError(429, { message: "Too many requests per minute" }))).toBe("rate_limited");
    expect(classifyCohereError(new CohereHttpError(503, undefined))).toBe("unavailable");
    expect(classifyCohereError(new CohereHttpError(400, { message: "invalid" }))).toBe("other");
    expect(classifyCohereError(new CohereTimeoutError())).toBe("unavailable");
  });
});
