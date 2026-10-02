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
const PRODUCTION: Pick<Env, "environment" | "smsMode" | "twilio" | "smsTestAllowlist"> = {
  environment: "production",
  smsMode: "live",
  twilio: { accountSid: "AC-fake", authToken: "fake-token", fromNumber: "+18885550100" },
  smsTestAllowlist: NUMBERS,
};

async function render(role: StaffRole = "admin") {
  const { default: Page } = await import("./page");
  session.current = ADMIN({ role });
  return renderToStaticMarkup((await Page({})) as never);
}

beforeEach(() => {
  session.current = null;
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
