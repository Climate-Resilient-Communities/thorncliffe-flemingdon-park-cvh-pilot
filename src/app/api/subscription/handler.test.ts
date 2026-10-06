// The answers of /api/subscription/view, /change and /delete (S07.06) with a fake edit link: every answer, refusals and failures included,
// carries Cache-Control: no-store and Referrer-Policy: no-referrer and sets no cookie; an expired link is a success body; nothing the request
// held (the token, the choices) reaches a log line. The edit link itself runs against a database in test/db/editLink.db.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditChange } from "@/contracts/subscriptionEdit";
import type { EditLink, SubscriptionsLog } from "@/modules/subscriptions";
import { stdoutSubscriptionsLog } from "@/modules/subscriptions";
import { subscriptionChangeResponse, subscriptionDeleteResponse, subscriptionMethodNotAllowed, subscriptionViewResponse, type SubscriptionRouteDeps } from "./handler";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";

afterEach(() => vi.restoreAllMocks());
const VIEW = { v: 1 as const, status: "ok" as const, subscription: { lang: "en" as const, neighbourhood: "TP", places: [], groups: [], muted_topics: [], phone_last2: "23" } };

function fakeEdit(over: Partial<EditLink> = {}): EditLink & { changes: EditChange[] } {
  const changes: EditChange[] = [];
  return {
    changes,
    port: { available: true, send: async () => undefined },
    view: async () => VIEW,
    change: async (change) => {
      changes.push(change);
      return { kind: "changed" };
    },
    delete: async () => ({ kind: "deleted" }),
    ...over,
  };
}

const post = (body: unknown) => new Request("https://cvh.example/api/subscription/x", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const changeBody = { v: 1, token: TOKEN, lang: "fr", neighbourhood: "FP", places: [{ rsn: "4154146", floors: [] }], groups: ["seniors"], muted_topics: ["water"] };

function deps(edit: EditLink, log: SubscriptionsLog = { info: () => {}, error: () => {} }, afterChanged = vi.fn()): SubscriptionRouteDeps & { afterChanged: ReturnType<typeof vi.fn> } {
  return { edit: () => edit, log, afterChanged };
}

async function expectPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("set-cookie")).toBeNull();
}

describe("POST /api/subscription/view", () => {
  it("answers the choices, or expired as a success body, and never anything for a body that is not a token", async () => {
    let response = await subscriptionViewResponse(deps(fakeEdit()), post({ v: 1, token: TOKEN }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(VIEW);
    await expectPrivate(response);

    response = await subscriptionViewResponse(deps(fakeEdit({ view: async () => ({ v: 1, status: "expired" }) })), post({ v: 1, token: TOKEN }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ v: 1, status: "expired" });

    for (const bad of ["{", { v: 1, token: "short" }, "x".repeat(40_000)]) {
      response = await subscriptionViewResponse(deps(fakeEdit()), post(bad));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "invalid_request", message_key: "subscriptionEdit.error.invalid_request" } });
      await expectPrivate(response);
    }
  });
});

describe("POST /api/subscription/change", () => {
  it("hands the checked change on, answers changed and starts the dispatcher; expired and refusals start nothing", async () => {
    const edit = fakeEdit();
    const routeDeps = deps(edit);
    let response = await subscriptionChangeResponse(routeDeps, post(changeBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ v: 1, status: "changed" });
    await expectPrivate(response);
    expect(edit.changes).toEqual([{ token: TOKEN, lang: "fr", neighbourhood: "FP", places: [{ rsn: "4154146", floors: [] }], groups: ["seniors"], mutedTopics: ["water"] }]);
    expect(routeDeps.afterChanged).toHaveBeenCalledTimes(1);

    const expired = deps(fakeEdit({ change: async () => ({ kind: "expired" }) }));
    response = await subscriptionChangeResponse(expired, post(changeBody));
    expect([response.status, await response.json()]).toEqual([200, { v: 1, status: "expired" }]);
    expect(expired.afterChanged).not.toHaveBeenCalled();

    const refused = deps(fakeEdit({ change: async () => ({ kind: "refused", code: "place_unknown" }) }));
    response = await subscriptionChangeResponse(refused, post(changeBody));
    expect([response.status, await response.json()]).toEqual([400, { error: { code: "place_unknown", message_key: "subscriptionEdit.error.place_unknown" } }]);
    await expectPrivate(response);

    response = await subscriptionChangeResponse(deps(fakeEdit()), post({ ...changeBody, neighbourhood: null }));
    expect([response.status, (await response.json()).error.code]).toEqual([400, "neighbourhood_missing"]);
  });

  it("answers a failure 503 and logs its classification only: never the token, the choices or the error's text", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
    const failing = fakeEdit({
      change: async () => {
        throw new Error(`could not change ${TOKEN} for +14165550123`);
      },
    });
    const response = await subscriptionChangeResponse(deps(failing, stdoutSubscriptionsLog), post(changeBody));
    expect([response.status, (await response.json()).error.code]).toEqual([503, "edit_unavailable"]);
    await expectPrivate(response);
    expect(lines.map((line) => JSON.parse(line))).toEqual([{ level: "error", evt: "subscription_edit.failed", module: "subscriptions", action: "change", code: "Error" }]);
  });
});

describe("POST /api/subscription/delete", () => {
  it("answers deleted, or expired, and logs the outcome only", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
    let response = await subscriptionDeleteResponse(deps(fakeEdit(), stdoutSubscriptionsLog), post({ v: 1, token: TOKEN }));
    expect([response.status, await response.json()]).toEqual([200, { v: 1, status: "deleted" }]);
    await expectPrivate(response);
    response = await subscriptionDeleteResponse(deps(fakeEdit({ delete: async () => ({ kind: "expired" }) }), stdoutSubscriptionsLog), post({ v: 1, token: TOKEN }));
    expect([response.status, await response.json()]).toEqual([200, { v: 1, status: "expired" }]);
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { level: "info", evt: "subscription_edit.delete", module: "subscriptions", outcome: "deleted" },
      { level: "info", evt: "subscription_edit.delete", module: "subscriptions", outcome: "expired" },
    ]);
    expect(lines.join("\n")).not.toContain(TOKEN);
  });
});

describe("any other method", () => {
  it("is 405 with the same headers", async () => {
    const response = subscriptionMethodNotAllowed();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    await expectPrivate(response);
  });
});
