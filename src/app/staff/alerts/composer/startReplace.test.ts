// "Save draft" on a new correction or withdrawal (S05.02, O-15): what the start forms send, as `correctEntry` and `withdrawEntry` take them, and what the person is
// told. The use cases judge the thread, the role, the target, the reason, the phase and the valid-until; this reads the form.
import { describe, expect, it, vi } from "vitest";
import { UNTIL_RESOLVED_MS, type AlertRefusal, type CorrectInput, type WithdrawInput } from "@/modules/alerting";
import { startCorrectionFromForm, startWithdrawalFromForm, type StartReplaceDeps } from "./startReplace";

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ENTRY = "01900000-0000-7000-8000-00000000e999";
const TARGET = "01900000-0000-7000-8000-00000000e100";
const session = { staffId: "01900000-0000-7000-8000-0000000000c1", aal: "aal2" as const };
const NOW = new Date("2026-10-04T14:00:00.000Z");

function deps(result: { ok: true } | { ok: false; error: AlertRefusal } = { ok: true }) {
  const done = (id: string) => (result.ok ? { ok: true as const, value: { thread: {}, entry: { id } } } : result);
  const correctEntry = vi.fn<(actor: unknown, ref: { alertId: string; targetId: string }, input: CorrectInput) => Promise<unknown>>(async (_actor, _ref, input) => done(input.entryId));
  const withdrawEntry = vi.fn<(actor: unknown, ref: { alertId: string; targetId: string }, input: WithdrawInput) => Promise<unknown>>(async (_actor, _ref, input) => done(input.entryId));
  const wired: StartReplaceDeps = { alerting: () => ({ correctEntry, withdrawEntry }) as unknown as ReturnType<StartReplaceDeps["alerting"]>, now: () => NOW };
  return { correctEntry, withdrawEntry, wired };
}

const form = (entries: Array<[string, string]>) => {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
};
const correction: Array<[string, string]> = [["alert", ALERT], ["entry", ENTRY], ["target", TARGET], ["text", "  Power is out on floors 1 to 8.\r\nNot floors 1 to 6.  "], ["phase", "problem"], ["valid-mode", "resolved"]];
const withdrawal: Array<[string, string]> = [["alert", ALERT], ["entry", ENTRY], ["target", TARGET], ["reason", "wrong_place"], ["text", ""]];

describe("starting a correction from the form", () => {
  it("makes it from the corrected words (line ends and edges tidied), the chosen phase and 'until resolved', for the thread, the target and the entry id the form names, and goes on to its composer", async () => {
    const { correctEntry, wired } = deps();
    const state = await startCorrectionFromForm(wired, session, form([...correction, ["from", "correct"]]));

    expect(correctEntry).toHaveBeenCalledWith({ staffId: session.staffId, aal: "aal2" }, { alertId: ALERT, targetId: TARGET }, {
      entryId: ENTRY,
      text: "Power is out on floors 1 to 8.\nNot floors 1 to 6.",
      phase: "problem",
      validUntil: new Date(NOW.getTime() + UNTIL_RESOLVED_MS),
      validUntilMode: "resolved",
    });
    expect(state).toEqual({ status: "started", location: `/staff/alerts/correct?alert=${ALERT}&entry=${ENTRY}&saved=1` });
  });

  it("goes to the correction's composer whatever page the form says it came from", async () => {
    const { wired } = deps();
    expect(await startCorrectionFromForm(wired, session, form(correction))).toEqual({ status: "started", location: `/staff/alerts/correct?alert=${ALERT}&entry=${ENTRY}&saved=1` });
    expect(await startCorrectionFromForm(wired, session, form([...correction, ["from", "https://elsewhere.example/"]]))).toEqual({ status: "started", location: `/staff/alerts/correct?alert=${ALERT}&entry=${ENTRY}&saved=1` });
  });

  it("reads a date and a time as Toronto time", async () => {
    const { correctEntry, wired } = deps();
    await startCorrectionFromForm(wired, session, form([...correction.filter(([name]) => name !== "valid-mode"), ["valid-mode", "at"], ["valid-date", "2026-10-06"], ["valid-time", "17:45"]]));
    expect(correctEntry.mock.calls[0][2]).toMatchObject({ validUntil: new Date("2026-10-06T21:45:00.000Z"), validUntilMode: "at" });
  });

  it("does not choose a phase for the person: none chosen goes on as nothing and the use case refuses it", async () => {
    const { correctEntry, wired } = deps({ ok: false, error: "PHASE_INVALID" });
    const state = await startCorrectionFromForm(wired, session, form(correction.filter(([name]) => name !== "phase")));
    expect(state).toEqual({ status: "refused", message: "Choose where things stand." });
    expect(correctEntry.mock.calls[0][2].phase).toBe("");
  });

  it("answers a time that does not exist without calling the use case, and asks before or after the clock change for a time that repeats", async () => {
    const { correctEntry, wired } = deps();
    const at = (date: string, time: string) => form([...correction.filter(([name]) => name !== "valid-mode"), ["valid-mode", "at"], ["valid-date", date], ["valid-time", time]]);
    expect(await startCorrectionFromForm(wired, session, at("", ""))).toEqual({ status: "refused", message: "Enter a date and a time." });
    expect(await startCorrectionFromForm({ ...wired, now: () => new Date("2026-10-30T12:00:00.000Z") }, session, at("2026-11-01", "01:30"))).toMatchObject({ status: "ask" });
    expect(correctEntry).not.toHaveBeenCalled();
  });

  it.each([
    ["TARGET_NOT_VALID", "That entry is not one that can be corrected or withdrawn."],
    ["TARGET_SUPERSEDED", "That entry was corrected or withdrawn already."],
    ["TARGET_NOT_PUBLISHED", "Residents have not read that entry"],
    ["ALERT_CLOSED", "This alert is already closed."],
    ["NOT_ALLOWED", "You cannot change or submit this alert."],
  ] as const)("tells the person why a refusal of %s, in words, and stays on the form", async (error, words) => {
    const { wired } = deps({ ok: false, error });
    expect(await startCorrectionFromForm(wired, session, form(correction))).toMatchObject({ status: "refused", message: expect.stringContaining(words) });
  });

  it("names the actor the session names and nothing from the form for who they are", async () => {
    const { correctEntry, wired } = deps();
    await startCorrectionFromForm(wired, { staffId: "01900000-0000-7000-8000-0000000000c9", aal: "aal1" }, form([...correction, ["staffId", session.staffId], ["aal", "aal2"]]));
    expect(correctEntry.mock.calls[0][0]).toEqual({ staffId: "01900000-0000-7000-8000-0000000000c9", aal: "aal1" });
  });
});

describe("starting a withdrawal from the form", () => {
  it("gives the catalog's words for a reason of the catalog, in English, and goes on to the withdrawal's composer", async () => {
    const { withdrawEntry, wired } = deps();
    const state = await startWithdrawalFromForm(wired, session, form(withdrawal));
    expect(withdrawEntry).toHaveBeenCalledWith({ staffId: session.staffId, aal: "aal2" }, { alertId: ALERT, targetId: TARGET }, {
      entryId: ENTRY,
      reason: "wrong_place",
      text: "This alert named the wrong place. It has been withdrawn.",
    });
    expect(state).toEqual({ status: "started", location: `/staff/alerts/withdraw?alert=${ALERT}&entry=${ENTRY}&saved=1` });
  });

  it("adds the Hub's own words after the catalog's, and gives each reason its own words", async () => {
    const { withdrawEntry, wired } = deps();
    await startWithdrawalFromForm(wired, session, form([...withdrawal.filter(([name]) => name !== "text"), ["text", " See the other alert. "]]));
    expect(withdrawEntry.mock.calls[0][2].text).toBe("This alert named the wrong place. It has been withdrawn. See the other alert.");
    for (const [reason, words] of [["wrong_information", "This alert had wrong information. It has been withdrawn."], ["duplicate", "This alert repeated another alert. It has been withdrawn."]] as const) {
      await startWithdrawalFromForm(wired, session, form([...withdrawal.filter(([name]) => name !== "reason"), ["reason", reason]]));
      expect(withdrawEntry.mock.calls.at(-1)?.[2]).toMatchObject({ reason, text: words });
    }
  });

  it("takes the Hub's words alone for \"other\", and sends nothing for them when there are none, so the use case refuses it", async () => {
    const { withdrawEntry, wired } = deps();
    await startWithdrawalFromForm(wired, session, form([...withdrawal.filter(([name]) => name !== "reason" && name !== "text"), ["reason", "other"], ["text", "The date was a day out."]]));
    expect(withdrawEntry.mock.calls[0][2]).toMatchObject({ reason: "other", text: "The date was a day out." });
    const refused = deps({ ok: false, error: "TEXT_EMPTY" });
    expect(await startWithdrawalFromForm(refused.wired, session, form([...withdrawal.filter(([name]) => name !== "reason"), ["reason", "other"]]))).toEqual({ status: "refused", message: "Write the text of the alert." });
    expect(refused.withdrawEntry.mock.calls[0][2].text).toBe("");
  });

  it("does not choose a reason for the person: none, or one that is not in the catalog, goes on as it is and the use case refuses it", async () => {
    const { withdrawEntry, wired } = deps({ ok: false, error: "WITHDRAWAL_REASON_INVALID" });
    for (const reason of [undefined, "", "because"]) {
      const state = await startWithdrawalFromForm(wired, session, form([...withdrawal.filter(([name]) => name !== "reason"), ...(reason === undefined ? [] : ([["reason", reason]] as Array<[string, string]>))]));
      expect(state).toEqual({ status: "refused", message: "Choose why you are withdrawing it." });
    }
    expect(withdrawEntry.mock.calls.map((call) => call[2].reason)).toEqual(["", "", "because"]);
  });

  it("tells the person when the entry was corrected or withdrawn first", async () => {
    const { wired } = deps({ ok: false, error: "TARGET_SUPERSEDED" });
    expect(await startWithdrawalFromForm(wired, session, form(withdrawal))).toMatchObject({ status: "refused", message: expect.stringContaining("corrected or withdrawn already") });
  });
});
