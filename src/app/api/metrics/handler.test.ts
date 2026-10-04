import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { USAGE_EVENTS, type UsageEvent } from "@/contracts/usage";
import { metricsResponse } from "./handler";

// S02.15, AR-26: POST /api/metrics counts one event and stores nothing else, sets no cookie, and reads nothing of the request but its body.

function post(body: string | Uint8Array, headers: Record<string, string> = {}) {
  return new Request("https://cvh.example/api/metrics", { method: "POST", body: body as BodyInit, headers });
}

function counter() {
  const counted: UsageEvent[] = [];
  return { counted, deps: { count: async (event: UsageEvent) => void counted.push(event) } };
}

const setCookies = (response: Response) => [...response.headers.entries()].filter(([name]) => name.toLowerCase() === "set-cookie");

describe("POST /api/metrics (S02.15)", () => {
  it("counts a valid event once and answers 204 with no body, no cookie and no caching", async () => {
    const { counted, deps } = counter();

    const response = await metricsResponse(deps, post(JSON.stringify({ evt: "directory_view", lang: "ur", nbhd: "FP" })));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(setCookies(response)).toEqual([]);
    expect(counted).toEqual([{ evt: "directory_view", lang: "ur", nbhd: "FP" }]);
  });

  it("counts each of the six events, with the neighbourhood left out", async () => {
    const { counted, deps } = counter();

    for (const evt of USAGE_EVENTS) expect((await metricsResponse(deps, post(JSON.stringify({ evt, lang: "en" })))).status, evt).toBe(204);

    expect(counted).toEqual(USAGE_EVENTS.map((evt) => ({ evt, lang: "en" })));
  });

  it("refuses an unknown event or language, an extra field, a bad neighbourhood and a body that is not JSON, counting nothing", async () => {
    const { counted, deps } = counter();
    const bodies = [
      JSON.stringify({ evt: "pageview", lang: "en" }),
      JSON.stringify({ evt: "install", lang: "klingon" }),
      JSON.stringify({ evt: "install", lang: "en", rsn: "123" }),
      JSON.stringify({ evt: "install", lang: "en", nbhd: "TP", building: "123" }),
      JSON.stringify({ evt: "install", lang: "en", nbhd: "XX" }),
      JSON.stringify({ evt: "install" }),
      JSON.stringify([{ evt: "install", lang: "en" }]),
      JSON.stringify(null),
      "evt=install&lang=en",
      "{not json",
      "",
    ];

    for (const body of bodies) {
      const response = await metricsResponse(deps, post(body));

      expect(response.status, body).toBe(400);
      expect(response.headers.get("cache-control"), body).toBe("no-store");
      expect(setCookies(response), body).toEqual([]);
    }
    expect(counted).toEqual([]);
  });

  it("refuses a body over 256 bytes, even one that starts as a valid event, and does not count it", async () => {
    const { counted, deps } = counter();
    const valid = JSON.stringify({ evt: "install", lang: "en" });
    const padded = `${valid}${" ".repeat(256 - valid.length + 1)}`;
    expect(new TextEncoder().encode(padded).byteLength).toBe(257);

    expect((await metricsResponse(deps, post(padded))).status).toBe(400);
    expect((await metricsResponse(deps, post(`${valid}${" ".repeat(256 - valid.length)}`))).status).toBe(204);
    // A declared length over the limit is refused unread; so is a stream that outgrows what it declared.
    expect((await metricsResponse(deps, post(valid, { "content-length": "9999" }))).status).toBe(400);
    expect((await metricsResponse(deps, post(new Uint8Array(100_000).fill(32)))).status).toBe(400);
    expect(counted).toHaveLength(1);
  });

  it("stores the event and nothing else, whatever the request carries: address, user agent, cookie, referrer", async () => {
    const { counted, deps } = counter();
    const request = post(JSON.stringify({ evt: "listing_view", lang: "en" }), {
      "x-forwarded-for": "203.0.113.9",
      "x-real-ip": "203.0.113.9",
      "user-agent": "Mozilla/5.0 (secret-device)",
      cookie: "session=abc; device=xyz",
      referer: "https://cvh.example/en/buildings/12345",
      authorization: "Bearer token",
      "x-device-id": "d-1",
    });
    const read = vi.spyOn(request.headers, "get");

    const response = await metricsResponse(deps, request);

    expect(response.status).toBe(204);
    expect(counted).toEqual([{ evt: "listing_view", lang: "en" }]);
    expect(Object.keys(counted[0]).sort()).toEqual(["evt", "lang"]);
    // The only header the handler looks at is the declared length of the body.
    expect(read.mock.calls.map(([name]) => String(name).toLowerCase())).toEqual(["content-length"]);
    expect(JSON.stringify(counted)).not.toMatch(/203\.0\.113|Mozilla|secret|session|device|xyz|12345|token/);
  });

  it("answers 503 when it cannot count, tells the failure hook nothing about the request, and sets no cookie", async () => {
    const failures: unknown[] = [];
    const response = await metricsResponse(
      {
        count: async () => {
          throw new Error("connection refused for evt=install lang=en");
        },
        onFailure: (error) => failures.push(error),
      },
      post(JSON.stringify({ evt: "install", lang: "en" }), { "user-agent": "ua" }),
    );

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("install");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(setCookies(response)).toEqual([]);
    expect(failures).toHaveLength(1);
  });
});

describe("the metrics route keeps nothing about the request (S02.15)", () => {
  // The files that handle the request and write the count. None may name the client's address, its user agent or its cookies,
  // read a header other than the body's length, or log the request.
  const files = [
    path.join(__dirname, "handler.ts"),
    path.join(__dirname, "route.ts"),
    path.join(__dirname, "../../../modules/directory/application/usageCount.ts"),
  ];

  it.each(files)("%s never reads the address, the user agent, a cookie or the headers", (file) => {
    const code = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/*"))
      .join("\n");

    expect(code).not.toMatch(/clientAddress|x-forwarded-for|x-real-ip|user-agent|userAgent|cookies?\b|\bip\b|getClientAddress|NextRequest|geo/i);
    expect(code).not.toMatch(/request\.headers(?!\.get\("content-length"\))/);
    expect(code).not.toMatch(/console\.(log|info|warn|error)\([^)]*request/);
  });
});
