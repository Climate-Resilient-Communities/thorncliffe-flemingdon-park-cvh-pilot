// The Test text page (S01.15): the button where texts can be sent, "Texts are only sent from
// production" on a preview or wherever SMS_MODE is not live, and the Admin-only refusal view.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffRole } from "@/contracts/staffRoles";
import type { Env } from "@/platform/config/env";
import type { StaffSession } from "../session";

const session = vi.hoisted(() => ({ current: null as StaffSession | null }));

vi.mock("../session", () => ({ currentStaffSession: async () => session.current }));
vi.mock("../identity", () => ({ identity: () => ({}), staffAuth: () => ({}) }));
vi.mock("./actions", () => ({ sendTestTextAction: async () => ({ status: "idle" }) }));

const attempts = vi.hoisted(() => ({ current: [] as { id: number; claimedAt: Date }[] }));
vi.mock("@/platform/db", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/messaging", async (original) => ({ ...(await original<typeof import("@/modules/messaging")>()), listUnknownAttempts: async () => attempts.current }));

const env = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/platform/config/env", () => ({
  getEnv: () => {
    if (env.current instanceof Error) throw env.current;
    return env.current;
  },
}));

const ADMIN = (overrides: Partial<StaffSession> = {}): StaffSession => ({
  staffId: "01900000-0000-7000-8000-000000000001",
  username: "jdoe",
  firstName: "Jane",
  lastName: "Doe",
  role: "admin",
  gate: "hub",
  sessionId: "a".repeat(64),
  aal: "aal2",
  ...overrides,
});

// Obviously fake numbers.
const NUMBERS = ["+14165550101", "+14165550102"];
const PRODUCTION: Pick<Env, "environment" | "smsMode" | "twilio" | "smsTestAllowlist" | "smsTestProblem"> = {
  environment: "production",
  smsMode: "live",
  twilio: { accountSid: "AC-fake", authToken: "fake-token", fromNumber: "+18885550100" },
  smsTestAllowlist: NUMBERS,
};

async function element(role: StaffRole = "admin") {
  const { default: Page } = await import("./page");
  session.current = ADMIN({ role });
  return Page({}) as Promise<never>;
}
const render = async (role: StaffRole = "admin") => renderToStaticMarkup(await element(role));

beforeEach(() => {
  session.current = null;
  attempts.current = [];
  env.current = PRODUCTION;
});

describe("the Test text page", () => {
  it("shows the Send test text button and the approved phones, masked, in production with SMS_MODE live", async () => {
    const html = await render();

    expect(html).toContain("Test text");
    expect(html).toContain(">Send test text</button>");
    expect(html.match(/<option /g)).toHaveLength(2);
    expect(html).toContain("+1 ••• ••• 0101");
    expect(html).toContain('type="hidden" name="requestId"');
    expect(html).not.toContain("Texts are only sent from production");
  });

  it("never sends a full approved number to the browser: not in the HTML, not in the props the client form gets, only masked labels and opaque values", async () => {
    const html = await render();
    const props = JSON.stringify(await element());

    for (const text of [html, props]) {
      expect(text).not.toContain("+14165550101");
      expect(text).not.toContain("+14165550102");
      expect(text).not.toContain("4165550101");
      expect(text).not.toContain("4165550102");
      expect(text).not.toContain("+18885550100");
    }
    const values = [...html.matchAll(/<option value="([^"]*)"/g)].map((match) => match[1]);
    expect(values).toHaveLength(2);
    for (const value of values) expect(value).toMatch(/^[0-9a-f]{16}$/);
    expect(new Set(values).size).toBe(2);
    expect(html).toContain("+1 ••• ••• 0101");
    expect(html).toContain("+1 ••• ••• 0102");
  });

  it("tells masked labels apart when two approved numbers end in the same four digits", async () => {
    env.current = { ...PRODUCTION, smsTestAllowlist: ["+14165550101", "+16475550101"] };

    const html = await render();

    expect(html).toContain(">+1 ••• ••• 0101</option>");
    expect(html).toContain(">+1 ••• ••• 0101 (2)</option>");
  });

  it("shows the notice, not the button, when a spike variable is malformed (smsTestProblem), without naming any value", async () => {
    env.current = { ...PRODUCTION, smsTestAllowlist: [], smsTestProblem: "SMS_TEST_ALLOWLIST: every entry must be an E.164 number" };

    const html = await render();

    expect(html).toContain("not valid");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Texts are only sent from production");
  });

  it("lists attempts with an unknown outcome, by id and time and never a number", async () => {
    attempts.current = [{ id: 12, claimedAt: new Date("2026-10-05T14:03:00Z") }];

    const html = await render();

    expect(html).toContain("Outcome unknown");
    expect(html).toContain("Attempt 12, started 2026-10-05 14:03 UTC: outcome unknown");
    expect(html).not.toContain("5550101");
  });

  it("lists no unknown attempts when there are none, and not on a preview", async () => {
    expect(await render()).not.toContain("Outcome unknown");
    attempts.current = [{ id: 12, claimedAt: new Date("2026-10-05T14:03:00Z") }];
    env.current = { ...PRODUCTION, smsMode: "log" };
    expect(await render()).not.toContain("Outcome unknown");
  });

  it.each([
    ["a preview", { ...PRODUCTION, environment: "preview", smsMode: "log", twilio: undefined, smsTestAllowlist: [] }],
    ["local development", { ...PRODUCTION, environment: "development", smsMode: "log", twilio: undefined, smsTestAllowlist: [] }],
    ["production with SMS_MODE not live", { ...PRODUCTION, smsMode: "log" }],
    ["an environment that did not validate", new Error("unsafe environment")],
  ])("replaces the button with \"Texts are only sent from production\" on %s", async (_name, value) => {
    env.current = value;

    const html = await render();

    expect(html).toContain("Texts are only sent from production");
    expect(html).not.toContain("Send test text</button>");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<select");
  });

  it("shows a notice, and no button, in production when Twilio or the approved numbers are not set", async () => {
    for (const missing of [{ twilio: undefined }, { twilio: { ...PRODUCTION.twilio!, fromNumber: undefined } }, { smsTestAllowlist: [] }]) {
      env.current = { ...PRODUCTION, ...missing };

      const html = await render();

      expect(html).toContain("SMS_TEST_ALLOWLIST");
      expect(html).not.toContain("<form");
      expect(html).not.toContain("Texts are only sent from production");
    }
  });

  it.each(["coordinator", "ambassador", "director"] as const)("shows a %s only that an Admin can send a test text, never the form or a number", async (role) => {
    const html = await render(role);

    expect(html).toContain("Only an Admin can send a test text.");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("5550101");
  });
});
