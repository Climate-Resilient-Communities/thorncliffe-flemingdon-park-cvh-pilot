// "Save draft" on a new update (S05.01): what the start form sends, as `addUpdate` takes it, and what the person is told. The use case judges the thread, the
// role, the phase and the valid-until; this reads the form: the text, the phase (a choice is never made for the person), the valid-until ("until resolved"
// is 24 elapsed hours from now, a time is Toronto time) and the id the page made for the entry.
import { describe, expect, it, vi } from "vitest";
import { UNTIL_RESOLVED_MS, type AddUpdateInput, type AlertRefusal } from "@/modules/alerting";
import { startUpdateFromForm, type StartDeps } from "./startUpdate";

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ENTRY = "01900000-0000-7000-8000-00000000e999";
const session = { staffId: "01900000-0000-7000-8000-0000000000c1", aal: "aal2" as const };
const NOW = new Date("2026-10-04T14:00:00.000Z");

function deps(result: { ok: true } | { ok: false; error: AlertRefusal } = { ok: true }) {
  const addUpdate = vi.fn<(actor: unknown, ref: { alertId: string }, input: AddUpdateInput) => Promise<unknown>>(async (_actor, _ref, input) =>
    result.ok ? { ok: true as const, value: { thread: {}, entry: { id: input.entryId } } } : result,
  );
  const wired: StartDeps = { alerting: () => ({ addUpdate }) as unknown as ReturnType<StartDeps["alerting"]>, now: () => NOW };
  return { addUpdate, wired };
}

const form = (entries: Array<[string, string]>) => {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
};
const base: Array<[string, string]> = [["alert", ALERT], ["entry", ENTRY], ["text", "  Power is back on floors 1 to 4.\r\nFloors 5 to 8 are still out.  "], ["phase", "in_progress"], ["valid-mode", "resolved"]];

describe("starting an update from the form", () => {
  it("makes the update from the text (line ends and edges tidied), the chosen phase and 'until resolved' as 24 elapsed hours from now, for the thread and entry id the form names, and goes on to its composer", async () => {
    const { addUpdate, wired } = deps();
    const state = await startUpdateFromForm(wired, session, form([...base, ["from", "promote"]]));

    expect(addUpdate).toHaveBeenCalledWith({ staffId: session.staffId, aal: "aal2" }, { alertId: ALERT }, {
      entryId: ENTRY,
      text: "Power is back on floors 1 to 4.\nFloors 5 to 8 are still out.",
      phase: "in_progress",
      validUntil: new Date(NOW.getTime() + UNTIL_RESOLVED_MS),
      validUntilMode: "resolved",
    });
    expect(state).toEqual({ status: "started", location: `/staff/alerts/promote?alert=${ALERT}&entry=${ENTRY}` });
  });

  it("goes on to the update composer when the form came from it, and to it too when the form names no composer", async () => {
    const { wired } = deps();
    expect(await startUpdateFromForm(wired, session, form([...base, ["from", "update"]]))).toEqual({ status: "started", location: `/staff/alerts/update?alert=${ALERT}&entry=${ENTRY}` });
    expect(await startUpdateFromForm(wired, session, form(base))).toEqual({ status: "started", location: `/staff/alerts/update?alert=${ALERT}&entry=${ENTRY}` });
    // A form that names some other page is not trusted to say where to go.
    expect(await startUpdateFromForm(wired, session, form([...base, ["from", "https://elsewhere.example/"]]))).toEqual({ status: "started", location: `/staff/alerts/update?alert=${ALERT}&entry=${ENTRY}` });
  });

  it("reads a date and a time as Toronto time", async () => {
    const { addUpdate, wired } = deps();
    await startUpdateFromForm(wired, session, form([...base.filter(([name]) => name !== "valid-mode"), ["valid-mode", "at"], ["valid-date", "2026-10-06"], ["valid-time", "17:45"]]));
    expect(addUpdate.mock.calls[0][2]).toMatchObject({ validUntil: new Date("2026-10-06T21:45:00.000Z"), validUntilMode: "at" });
  });

  it("does not choose a phase for the person: none chosen, or something that is not one of the two, goes on as nothing and the use case refuses it", async () => {
    const { addUpdate, wired } = deps({ ok: false, error: "PHASE_INVALID" });
    for (const phase of [undefined, "", "resolved"]) {
      const state = await startUpdateFromForm(wired, session, form([...base.filter(([name]) => name !== "phase"), ...(phase === undefined ? [] : ([["phase", phase]] as Array<[string, string]>))]));
      expect(state).toEqual({ status: "refused", message: "Choose where things stand." });
    }
    expect(addUpdate.mock.calls.map((call) => call[2].phase)).toEqual(["", "", ""]);
  });

  it("answers a time that does not exist, or is not a time, without calling the use case", async () => {
    const { addUpdate, wired } = deps();
    const at = (date: string, time: string) => form([...base.filter(([name]) => name !== "valid-mode"), ["valid-mode", "at"], ["valid-date", date], ["valid-time", time]]);
    expect(await startUpdateFromForm({ ...wired, now: () => new Date("2026-03-01T12:00:00.000Z") }, session, at("2026-03-08", "02:30"))).toMatchObject({ status: "refused", message: expect.stringContaining("does not exist in Toronto") });
    expect(await startUpdateFromForm(wired, session, at("", ""))).toEqual({ status: "refused", message: "Enter a date and a time." });
    expect(addUpdate).not.toHaveBeenCalled();
  });

  it("asks before or after the clock change for a time the clocks repeat, as every composer does", async () => {
    const { addUpdate, wired } = deps();
    const state = await startUpdateFromForm({ ...wired, now: () => new Date("2026-10-30T12:00:00.000Z") }, session, form([...base.filter(([name]) => name !== "valid-mode"), ["valid-mode", "at"], ["valid-date", "2026-11-01"], ["valid-time", "01:30"]]));
    expect(state).toMatchObject({ status: "ask", question: expect.stringContaining("happens twice on") });
    expect(addUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["ALERT_CLOSED", "This alert is already closed."],
    ["NO_PUBLISHED_ENTRY", "Nothing is published in this alert yet"],
    ["ALERT_NOT_FOUND", "That alert draft was not found."],
    ["NOT_ALLOWED", "You cannot change or submit this alert."],
    ["TEXT_EMPTY", "Write the text of the alert."],
    ["VALID_UNTIL_PAST", "The valid-until time has passed."],
  ] as const)("tells the person why a refusal of %s, in the composer's words, and stays on the form", async (error, words) => {
    const { wired } = deps({ ok: false, error });
    expect(await startUpdateFromForm(wired, session, form(base))).toMatchObject({ status: "refused", message: expect.stringContaining(words) });
  });

  it("names the actor the session names and nothing from the form for who they are", async () => {
    const { addUpdate, wired } = deps();
    await startUpdateFromForm(wired, { staffId: "01900000-0000-7000-8000-0000000000c9", aal: "aal1" }, form([...base, ["staffId", session.staffId], ["aal", "aal2"]]));
    expect(addUpdate.mock.calls[0][0]).toEqual({ staffId: "01900000-0000-7000-8000-0000000000c9", aal: "aal1" });
  });
});
