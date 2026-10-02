// "Send test text" through its real guard (S01.15): only an Admin whose session reached aal2 gets to
// the use case; every other caller is refused before it, so no provider is ever called.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssuranceLevel } from "@/contracts/staffAuth";
import type { StaffRole } from "@/contracts/staffRoles";
import { numberChoice, numberKeyFromSecret } from "@/modules/messaging";
import type { Env } from "@/platform/config/env";
import type { StaffSession } from "../session";

const session = vi.hoisted(() => ({ current: null as StaffSession | null }));
const audits = vi.hoisted(() => ({ policy: [] as unknown[][], belowAal2: [] as unknown[][], unauthenticated: [] as unknown[][] }));
const service = vi.hoisted(() => ({ sendTestText: vi.fn(), refuseNotAllowlisted: vi.fn() }));
const env = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("../session", () => ({ currentStaffSession: async () => session.current }));
vi.mock("../identity", () => ({
  identity: () => ({ refuseUnauthenticated: async (...args: unknown[]) => void audits.unauthenticated.push(args) }),
  staffAuth: () => ({
    refuseOutsideGate: async () => {},
    refuseBelowAal2: async (...args: unknown[]) => void audits.belowAal2.push(args),
    refuseByPolicy: async (...args: unknown[]) => void audits.policy.push(args),
  }),
}));
// The real choice resolution runs on the validated environment; only the use case (and with it the provider) is a spy.
vi.mock("@/platform/config/env", () => ({ getEnv: () => env.current }));
vi.mock("@/platform/db", () => ({ getDb: () => ({}) }));
vi.mock("./compose", async (original) => ({ ...(await original<typeof import("./compose")>()), smsTestService: () => service }));

// Obviously fake values.
const NUMBER = "+14165550101";
const PRODUCTION: Pick<Env, "environment" | "smsMode" | "twilio" | "smsTestAllowlist"> = {
  environment: "production",
  smsMode: "live",
  twilio: { accountSid: "AC-fake", authToken: "fake-token", fromNumber: "+18885550100" },
  smsTestAllowlist: [NUMBER, "+14165550102"],
};
const choiceOf = (number: string) => numberChoice(numberKeyFromSecret("fake-token"), number);

const sessionOf = (role: StaffRole, aal: AssuranceLevel): StaffSession => ({
  staffId: "01900000-0000-7000-8000-000000000001",
  username: "jdoe",
  firstName: "Jane",
  lastName: "Doe",
  role,
  gate: "hub",
  sessionId: "a".repeat(64),
  aal,
});

const form = (number = choiceOf(NUMBER)) => {
  const data = new FormData();
  data.set("requestId", "01900000-0000-7000-8000-00000000f015");
  data.set("number", number);
  return data;
};

beforeEach(() => {
  session.current = null;
  audits.policy.length = 0;
  audits.belowAal2.length = 0;
  audits.unauthenticated.length = 0;
  service.sendTestText.mockReset();
  service.refuseNotAllowlisted.mockReset();
  service.refuseNotAllowlisted.mockResolvedValue({ kind: "refused", reason: "not_allowlisted" });
  env.current = PRODUCTION;
});

describe("the Send test text action", () => {
  it("is the privileged policy action sms.test_send, Admin only", async () => {
    const { guardSpecOf } = await import("../guard");
    const { sendTestTextAction } = await import("./actions");
    expect(guardSpecOf(sendTestTextAction)).toMatchObject({ route: "/staff/sms-test", access: "hub", action: "sms.test_send", privileged: "sms.test_send" });
  });

  it("hands an Admin at aal2 to the use case with the request id and the number its opaque choice stands for, and shows Twilio's status and message id", async () => {
    const { sendTestTextAction } = await import("./actions");
    session.current = sessionOf("admin", "aal2");
    service.sendTestText.mockResolvedValue({ kind: "sent", httpStatus: 201, status: "queued", messageId: `SM${"0".repeat(32)}` });

    const state = await sendTestTextAction({ status: "idle" }, form());

    expect(service.sendTestText).toHaveBeenCalledWith({ actorStaffId: "01900000-0000-7000-8000-000000000001", requestId: "01900000-0000-7000-8000-00000000f015", number: NUMBER });
    expect(state).toMatchObject({ status: "sent", lines: ["Twilio’s response: HTTP 201, status queued", `Message id: SM${"0".repeat(32)}`, expect.any(String)] });
  });

  it.each([
    ["an unknown choice", () => "0123456789abcdef"],
    ["a tampered choice", () => `${choiceOf(NUMBER).slice(0, 15)}0`],
    ["a full number typed in", () => NUMBER],
    ["the choice of a number that has left the approved list", () => choiceOf("+14165550199")],
    ["no choice at all", () => ""],
  ])("refuses %s before any provider call: audited as not allowlisted, no claim, no send", async (_name, choice) => {
    const { sendTestTextAction } = await import("./actions");
    session.current = sessionOf("admin", "aal2");

    const state = await sendTestTextAction({ status: "idle" }, form(choice()));

    expect(state).toMatchObject({ status: "refused", message: "That phone is not on the approved list. Nothing was sent." });
    expect(service.refuseNotAllowlisted).toHaveBeenCalledWith("01900000-0000-7000-8000-000000000001");
    expect(service.sendTestText).not.toHaveBeenCalled();
  });

  it("refuses every choice where texts cannot be sent (not live, or a spike variable is malformed)", async () => {
    const { sendTestTextAction } = await import("./actions");
    session.current = sessionOf("admin", "aal2");

    for (const unavailable of [{ smsMode: "log" }, { environment: "preview" }, { smsTestProblem: "SMS_TEST_ALLOWLIST: every entry must be an E.164 number" }]) {
      env.current = { ...PRODUCTION, ...unavailable };
      await expect(sendTestTextAction({ status: "idle" }, form()), JSON.stringify(unavailable)).resolves.toMatchObject({ status: "refused" });
    }
    expect(service.sendTestText).not.toHaveBeenCalled();
  });

  it("refuses an Admin below aal2 with aal2_required, audited, and never reaches the use case", async () => {
    const { sendTestTextAction } = await import("./actions");
    session.current = sessionOf("admin", "aal1");

    const state = await sendTestTextAction({ status: "idle" }, form());

    expect(state).toMatchObject({ status: "refused", message: expect.stringMatching(/authenticator code/) });
    expect(audits.belowAal2).toEqual([["01900000-0000-7000-8000-000000000001", "/staff/sms-test", "sms.test_send"]]);
    expect(service.sendTestText).not.toHaveBeenCalled();
  });

  it.each(["coordinator", "ambassador", "director"] as const)("refuses a %s as forbidden, audited, and never reaches the use case, even at aal2", async (role) => {
    const { sendTestTextAction } = await import("./actions");
    session.current = sessionOf(role, "aal2");

    const state = await sendTestTextAction({ status: "idle" }, form());

    expect(state).toMatchObject({ status: "refused", message: "Only an Admin can send a test text." });
    expect(audits.policy).toEqual([["01900000-0000-7000-8000-000000000001", "/staff/sms-test", "sms.test_send", "forbidden"]]);
    expect(service.sendTestText).not.toHaveBeenCalled();
  });

  it("says nothing was sent when the use case cannot run here (no environment or database)", async () => {
    const { sendTestTextAction } = await import("./actions");
    session.current = sessionOf("admin", "aal2");
    service.sendTestText.mockRejectedValue(new Error("DATABASE_URL is not set"));

    await expect(sendTestTextAction({ status: "idle" }, form())).resolves.toMatchObject({ status: "refused", message: "The test text could not be sent right now. Nothing was sent." });
  });

  it("gives every answer a fresh request id for the next press", async () => {
    const { sendTestTextAction } = await import("./actions");
    session.current = sessionOf("admin", "aal2");
    service.sendTestText.mockResolvedValue({ kind: "refused", reason: "duplicate_number" });

    const first = await sendTestTextAction({ status: "idle" }, form());
    const second = await sendTestTextAction({ status: "idle" }, form());

    expect(first).toMatchObject({ status: "refused", message: expect.stringMatching(/last 5 minutes/) });
    const ids = [first, second].map((state) => (state as { nextRequestId: string }).nextRequestId);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids).not.toContain("01900000-0000-7000-8000-00000000f015");
  });
});
