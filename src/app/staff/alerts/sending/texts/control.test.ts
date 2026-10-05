import { describe, expect, it, vi } from "vitest";
import type { Resend, ResendInput, ResendOutcome } from "@/modules/messaging";
import { answerOf, resendAllFromForm, resendOneFromForm, type ControlDeps } from "./control";

const ADMIN = { staffId: "01900000-0000-7000-8000-0000000000a1" };
const ENTRY = "01900000-0000-7000-8000-00000000e177";
const TEXT = "01900000-0000-7000-8000-0000000abc01";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

const resent = (over: Partial<Extract<ResendOutcome, { kind: "resent" }>> = {}): ResendOutcome => ({ kind: "resent", resent: 1, notResent: [], more: false, costCents: 4, overrun: null, resendN: 1, ...over });

function world(result: ResendOutcome | Error) {
  const logged: { event: string; fields: Record<string, string> }[] = [];
  const calls: ResendInput[] = [];
  const service: Resend = {
    resend: vi.fn(async (input: ResendInput) => {
      calls.push(input);
      if (result instanceof Error) throw result;
      return result;
    }),
  };
  const startSending = vi.fn(async () => undefined);
  const deps: ControlDeps = { resend: () => service, startSending, logError: (event, fields) => void logged.push({ event, fields }) };
  return { deps, calls, startSending, logged };
}

describe("pressing 'Resend' on one text", () => {
  it("resends as the signed-in Admin with the entry, the text, the status they saw and their confirmation from the form", async () => {
    const w = world(resent());
    const answer = await resendOneFromForm(w.deps, ADMIN, form({ entry: ENTRY, delivery: TEXT, seen: "unknown", confirm: "on" }));
    expect(w.calls).toEqual([{ actorStaffId: ADMIN.staffId, entryId: ENTRY, scope: "one", deliveryId: TEXT, seen: "unknown", confirmedUnknown: true }]);
    expect(answer).toEqual({ status: "done", lines: ["The text was resent. It is in the queue and goes out in its usual order."] });
  });

  it("takes no confirmation from anything but the box, and starts the sender once the resend has committed", async () => {
    const w = world(resent());
    await resendOneFromForm(w.deps, ADMIN, form({ entry: ENTRY, delivery: TEXT, seen: "failed", confirm: "yes" }));
    expect(w.calls[0]).toMatchObject({ confirmedUnknown: false, seen: "failed" });
    expect(w.startSending).toHaveBeenCalledTimes(1);
  });

  it("does not start the sender when nothing was resent", async () => {
    const w = world({ kind: "refused", reason: "resend_limit" });
    await resendOneFromForm(w.deps, ADMIN, form({ entry: ENTRY, delivery: TEXT, seen: "failed" }));
    expect(w.startSending).not.toHaveBeenCalled();
  });

  it.each([
    [{ entry: "nope", delivery: TEXT }],
    [{ entry: ENTRY, delivery: "nope" }],
    [{ entry: ENTRY }],
    [{}],
  ])("refuses a form that was not understood (%j) without calling the use case", async (fields) => {
    const w = world(resent());
    const answer = await resendOneFromForm(w.deps, ADMIN, form(fields));
    expect(answer).toEqual({ status: "refused", message: "The form was not understood. Nothing was resent. Reload the page and try again." });
    expect(w.calls).toEqual([]);
  });

  it("leaves everything as it was and says so when the resend fails, logging only the error's name", async () => {
    const w = world(new TypeError("the database refused +14165550123"));
    const answer = await resendOneFromForm(w.deps, ADMIN, form({ entry: ENTRY, delivery: TEXT, seen: "failed" }));
    expect(answer).toEqual({ status: "refused", message: "The texts could not be resent just now. Nothing was resent. Reload the page and try again. If this stays, tell IT." });
    expect(w.logged).toEqual([{ event: "messaging.resend_failed", fields: { error: "TypeError" } }]);
    expect(JSON.stringify(w.logged)).not.toContain("4165550123");
  });
});

describe("pressing 'Resend the failed and undelivered texts'", () => {
  it("resends the entry's texts in the language from the form, and says how many", async () => {
    const w = world(resent({ resent: 12, resendN: null }));
    const answer = await resendAllFromForm(w.deps, ADMIN, form({ entry: ENTRY, lang: "zh-Hant" }));
    expect(w.calls).toEqual([{ actorStaffId: ADMIN.staffId, entryId: ENTRY, scope: "language", lang: "zh-Hant" }]);
    expect(answer).toEqual({ status: "done", lines: ["12 texts were resent. They are in the queue and go out in their usual order."] });
    expect(w.startSending).toHaveBeenCalledTimes(1);
  });

  it.each([[{ entry: ENTRY, lang: "EN" }], [{ entry: ENTRY, lang: "" }], [{ entry: "x", lang: "en" }], [{ lang: "en" }]])("refuses a form that was not understood (%j)", async (fields) => {
    const w = world(resent());
    expect(await resendAllFromForm(w.deps, ADMIN, form(fields))).toMatchObject({ status: "refused" });
    expect(w.calls).toEqual([]);
  });
});

describe("what an outcome says", () => {
  it("says what was left out and why, that there are more, and that the cap was passed", () => {
    const answer = answerOf(
      resent({ resent: 3, notResent: [{ reason: "cannot_receive", n: 2 }, { reason: "resend_limit", n: 1 }], more: true, overrun: { overCents: 125, capCents: 10_000 } }),
    );
    expect(answer).toEqual({
      status: "done",
      lines: [
        "3 texts were resent. They are in the queue and go out in their usual order.",
        "3 left out: 2 the number cannot receive texts, 1 resent twice already.",
        "There are more texts to resend. Press the button again to take the next ones.",
        "These texts took this month's text spending $1.25 CAD past the cap of $100.00 CAD. They were still resent.",
      ],
    });
  });

  it("says nothing changed when nothing needed resending", () => {
    expect(answerOf(resent({ resent: 0 }))).toEqual({ status: "done", lines: ["No text needed resending. Nothing was changed."] });
  });

  it.each<[ResendOutcome, string]>([
    [{ kind: "refused", reason: "not_found" }, "That text was not found for this alert. Nothing was resent."],
    [{ kind: "refused", reason: "confirm_needed", status: "unknown" }, "This text has an unknown outcome. Tick the box to confirm that it may arrive twice. Nothing was resent."],
    [{ kind: "refused", reason: "resend_limit" }, "This text has already been resent twice, which is the most. Nothing was resent."],
    [{ kind: "refused", reason: "cannot_receive", meaning: "invalid_number" }, 'The provider said "Not a valid phone number", so this number cannot receive texts. Nothing was resent.'],
    [{ kind: "refused", reason: "recipient_gone" }, "The person is gone (they replied STOP or their number was deleted), so nothing was resent."],
    [{ kind: "refused", reason: "recipient_not_receiving" }, "The person no longer gets alerts, so nothing was resent."],
    [{ kind: "refused", reason: "not_sendable", cause: "thread_closed" }, "This alert can no longer send this text: the alert is closed. Nothing was resent."],
    [{ kind: "refused", reason: "not_resendable", status: "delivered" }, "That text is delivered, so it cannot be resent. Only a text that failed, was undelivered or has an unknown outcome can be. Nothing was resent."],
    [{ kind: "refused", reason: "already_resent", status: "queued" }, "A newer text was already made for this one (waiting), so it was not resent again. Reload the page to see it."],
  ])("turns the refusal %j into words that say nothing was resent", (outcome, message) => {
    expect(answerOf(outcome)).toEqual({ status: "refused", message });
  });

  it("names both statuses when a late callback changed the text after the Admin saw it", () => {
    expect(answerOf({ kind: "refused", reason: "status_changed", status: "delivered" }, "unknown")).toEqual({
      status: "refused",
      message: "This text is now delivered, not unknown, so it was not resent. Reload the page to see where it stands.",
    });
  });
});
