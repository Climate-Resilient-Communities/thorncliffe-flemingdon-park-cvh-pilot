// The REST client against a fake fetch: the request shapes of Cohere's v2 API (as the vendor's SDK sent them), the answers read
// back in the SDK's shape, and how a failure looks to the adapters. Nothing here reaches the network.
import { describe, expect, it } from "vitest";
import { CohereHttpError, CohereTimeoutError, createCohereRestClient } from "./restClient";

interface Seen {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function fakeFetch(respond: (seen: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const entry = { url: String(input), init: init ?? {}, body: JSON.parse(String(init?.body)) as Record<string, unknown> };
    seen.push(entry);
    return respond(entry);
  }) as typeof fetch;
  return { seen, fetch: fn };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const status = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { "Content-Type": "application/json" } });
const signal = () => new AbortController().signal;

describe("createCohereRestClient", () => {
  it("posts the embed request to /v2/embed in the API's snake_case, with a bearer key and no retry", async () => {
    const fake = fakeFetch(() => ok({ embeddings: { float: [[0.1, 0.2]] }, meta: { billed_units: { input_tokens: 7 } } }));
    const client = createCohereRestClient({ apiKey: "key-1", fetch: fake.fetch });

    const response = await client.v2.embed({ model: "embed-v4.0", texts: ["hello"], inputType: "search_query", embeddingTypes: ["float"], outputDimension: 512 }, { abortSignal: signal(), maxRetries: 0 });

    expect(fake.seen).toHaveLength(1);
    expect(fake.seen[0].url).toBe("https://api.cohere.com/v2/embed");
    expect(fake.seen[0].init.method).toBe("POST");
    expect((fake.seen[0].init.headers as Record<string, string>).Authorization).toBe("Bearer key-1");
    expect(fake.seen[0].body).toEqual({ model: "embed-v4.0", texts: ["hello"], input_type: "search_query", embedding_types: ["float"], output_dimension: 512 });
    expect(response).toEqual({ embeddings: { float: [[0.1, 0.2]] }, meta: { billedUnits: { inputTokens: 7, outputTokens: undefined } } });
  });

  it("leaves output_dimension out when none is asked for", async () => {
    const fake = fakeFetch(() => ok({ embeddings: { float: [[1]] } }));
    await createCohereRestClient({ apiKey: "k", fetch: fake.fetch }).v2.embed({ model: "m", texts: ["a"], inputType: "search_document", embeddingTypes: ["float"] }, { abortSignal: signal() });

    expect(fake.seen[0].body).not.toHaveProperty("output_dimension");
  });

  it("posts the chat request to /v2/chat and reads the text parts and billed units", async () => {
    const fake = fakeFetch(() => ok({ message: { role: "assistant", content: [{ type: "text", text: "hola" }] }, usage: { billed_units: { input_tokens: 5, output_tokens: 2 } } }));
    const client = createCohereRestClient({ apiKey: "k", fetch: fake.fetch });

    const response = await client.v2.chat(
      { model: "north-small-translate", messages: [{ role: "system", content: "s" }, { role: "user", content: "u" }], temperature: 0, maxTokens: 200 },
      { abortSignal: signal(), maxRetries: 0 },
    );

    expect(fake.seen[0].url).toBe("https://api.cohere.com/v2/chat");
    expect(fake.seen[0].body).toEqual({ model: "north-small-translate", messages: [{ role: "system", content: "s" }, { role: "user", content: "u" }], temperature: 0, max_tokens: 200, stream: false });
    expect(response.message?.content).toEqual([{ type: "text", text: "hola" }]);
    expect(response.usage?.billedUnits).toEqual({ inputTokens: 5, outputTokens: 2 });
  });

  it("throws the status and the parsed body of a failed call, and never the body in its message", async () => {
    const client = createCohereRestClient({ apiKey: "k", fetch: fakeFetch(() => status(429, { message: "You are past the per-month request limit: my secret question" })).fetch });

    const error = await client.v2.embed({ model: "m", texts: ["a"], inputType: "search_query", embeddingTypes: ["float"] }, { abortSignal: signal() }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CohereHttpError);
    expect((error as CohereHttpError).statusCode).toBe(429);
    expect((error as CohereHttpError).body).toEqual({ message: "You are past the per-month request limit: my secret question" });
    expect((error as Error).message).not.toContain("secret");
  });

  it("passes the caller's AbortSignal to fetch, so an abort ends the call", async () => {
    const hanging = fakeFetch((seen) => new Promise<Response>((_, reject) => (seen.init.signal as AbortSignal).addEventListener("abort", () => reject((seen.init.signal as AbortSignal).reason))));
    const controller = new AbortController();
    const pending = createCohereRestClient({ apiKey: "k", fetch: hanging.fetch }).v2.embed({ model: "m", texts: ["a"], inputType: "search_query", embeddingTypes: ["float"] }, { abortSignal: controller.signal });

    controller.abort();

    await expect(pending).rejects.toBeDefined();
  });

  it("ends a call the vendor never answers at its own timeout, as the vendor being unreachable", async () => {
    const hanging = fakeFetch((seen) => new Promise<Response>((_, reject) => (seen.init.signal as AbortSignal).addEventListener("abort", () => reject((seen.init.signal as AbortSignal).reason))));
    const client = createCohereRestClient({ apiKey: "k", fetch: hanging.fetch, timeoutMs: 30 });

    const error = await client.v2.chat({ model: "m", messages: [], temperature: 0, maxTokens: 1 }, { abortSignal: signal() }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CohereTimeoutError);
  });
});
