// "Send test text" through its real guard (S01.15): only an Admin whose session reached aal2 gets to
// the use case; every other caller is refused before it, so no provider is ever called.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssuranceLevel } from "@/contracts/staffAuth";
import type { StaffRole } from "@/contracts/staffRoles";
import type { StaffSession } from "../session";

const session = vi.hoisted(() => ({ current: null as StaffSession | null }));
const audits = vi.hoisted(() => ({ policy: [] as unknown[][], belowAal2: [] as unknown[][], unauthenticated: [] as unknown[][] }));
const service = vi.hoisted(() => ({ sendTestText: vi.fn() }));

vi.mock("../session", () => ({ currentStaffSession: async () => session.current }));
vi.mock("../identity", () => ({
  identity: () => ({ refuseUnauthenticated: async (...args: unknown[]) => void audits.unauthenticated.push(args) }),
  staffAuth: () => ({
    refuseOutsideGate: async () => {},
    refuseBelowAal2: async (...args: unknown[]) => void audits.belowAal2.push(args),
    refuseByPolicy: async (...args: unknown[]) => void audits.policy.push(args),
  }),
}));
vi.mock("./compose", () => ({ smsTestService: () => service, smsTestAvailability: () => ({ kind: "preview" }) }));

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

const form = (number = "+14165550101") => {
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
});

describe("the Send test text action", () => {
  it("is the privileged policy action sms.test_send, Admin only", async () => {
    const { guardSpecOf } = await import("../guard");
    const { sendTestTextAction } = await import("./actions");
    expect(guardSpecOf(sendTestTextAction)).toMatchObject({ route: "/staff/sms-test", access: "hub", action: "sms.test_send", privileged: "sms.test_send" });
  });

  it("hands an Admin at aal2 to the use case with the request id and number, and shows Twilio's status and message id", async () => {
    const { sendTestTextAction } = await import("./actions");
    session.current = sessionOf("admin", "aal2");
    service.sendTestText.mockResolvedValue({ kind: "sent", httpStatus: 201, status: "queued", messageId: `SM${"0".repeat(32)}` });

    const state = await sendTestTextAction({ status: "idle" }, form());

    expect(service.sendTestText).toHaveBeenCalledWith({ actorStaffId: "01900000-0000-7000-8000-000000000001", requestId: "01900000-0000-7000-8000-00000000f015", number: "+14165550101" });
    expect(state).toMatchObject({ status: "sent", lines: ["Twilio’s response: HTTP 201, status queued", `Message id: SM${"0".repeat(32)}`, expect.any(String)] });
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
