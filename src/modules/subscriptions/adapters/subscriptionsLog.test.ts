import { afterEach, describe, expect, it, vi } from "vitest";
import { stdoutSubscriptionsLog } from "./subscriptionsLog";

// S07.06: an edit link's token is a secret for 30 minutes (whoever has it can change or delete the subscription), so no application log line
// carries it, whatever field it reaches: the page's path, an error's text, the event's name. Phone numbers are masked as messaging's are.
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";

describe("the subscriptions log", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes one JSON line per event with the module, and takes an edit link token out of every text field, wherever it is", () => {
    expect(TOKEN).toHaveLength(43);
    const written: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void written.push(line));
    stdoutSubscriptionsLog.info("subscription_edit.view", { outcome: "ok", path: `/ur/subscription/${TOKEN}`, ms: 12, ok: true, note: null });
    stdoutSubscriptionsLog.error("subscription_edit.failed", { detail: `could not read ${TOKEN} for +14165550123`, url: `https://cvh.example/en/subscription/${TOKEN}?x=1` });
    stdoutSubscriptionsLog.info(`subscription_edit.${TOKEN}`, {});
    expect(written.map((line) => JSON.parse(line))).toEqual([
      { level: "info", evt: "subscription_edit.view", module: "subscriptions", outcome: "ok", path: "/ur/subscription/[token]", ms: 12, ok: true, note: null },
      { level: "error", evt: "subscription_edit.failed", module: "subscriptions", detail: "could not read [token] for +*********23", url: "https://cvh.example/en/subscription/[token]?x=1" },
      { level: "info", evt: "subscription_edit.[token]", module: "subscriptions" },
    ]);
    expect(written.join("\n")).not.toContain(TOKEN);
    expect(written.join("\n")).not.toContain(TOKEN.slice(0, 20));
    expect(written.join("\n")).not.toContain("4165550123");
  });

  it("leaves other ids as they are: a UUID, a sha256 hash, a Twilio SID", () => {
    const written: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void written.push(line));
    const fields = { id: "0190f000-0000-7000-8000-000000510001", hash: "a".repeat(64), sid: `SM${"0".repeat(32)}`, route: "/api/subscription/view" };
    stdoutSubscriptionsLog.info("subscription_edit.ids", fields);
    expect(JSON.parse(written[0]!)).toEqual({ level: "info", evt: "subscription_edit.ids", module: "subscriptions", ...fields });
  });
});
