// "Save draft" on a new final message (S05.03, O-16 "Mark resolved"): what the start form sends, as `startFinal` takes it, and what the person is told. The use case
// judges the thread, the role and the words; this reads the form: the text (line ends and edges tidied) and the id the page made for the entry.
import { describe, expect, it, vi } from "vitest";
import type { AlertRefusal, StartFinalInput } from "@/modules/alerting";
import { startFinalFromForm, type StartFinalDeps } from "./startFinal";

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ENTRY = "01900000-0000-7000-8000-00000000e999";
const session = { staffId: "01900000-0000-7000-8000-0000000000c1", aal: "aal2" as const };

function deps(result: { ok: true } | { ok: false; error: AlertRefusal } = { ok: true }) {
  const startFinal = vi.fn<(actor: unknown, ref: { alertId: string }, input: StartFinalInput) => Promise<unknown>>(async (_actor, _ref, input) =>
    result.ok ? { ok: true as const, value: { thread: {}, entry: { id: input.entryId } } } : result,
  );
  const wired: StartFinalDeps = { alerting: () => ({ startFinal }) as unknown as ReturnType<StartFinalDeps["alerting"]> };
  return { startFinal, wired };
}

const form = (entries: Array<[string, string]>) => {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
};
const base: Array<[string, string]> = [["alert", ALERT], ["entry", ENTRY], ["text", "  Power is back on all floors.\r\nCall Toronto Hydro if yours is still out.  "], ["from", "resolve"]];

describe("starting a final message from the form", () => {
  it("makes the final from the text (line ends and edges tidied), for the thread and the entry id the form names, as the person the session names, and goes on to its composer", async () => {
    const { startFinal, wired } = deps();

    const state = await startFinalFromForm(wired, session, form(base));

    expect(startFinal).toHaveBeenCalledWith({ staffId: session.staffId, aal: "aal2" }, { alertId: ALERT }, { entryId: ENTRY, text: "Power is back on all floors.\nCall Toronto Hydro if yours is still out." });
    expect(state).toEqual({ status: "started", location: `/staff/alerts/resolve?alert=${ALERT}&entry=${ENTRY}&saved=1` });
  });

  it("goes on to the final's own page whatever the form says it came from, and takes nothing from the form for who the person is", async () => {
    const { startFinal, wired } = deps();
    expect(await startFinalFromForm(wired, session, form([...base.filter(([name]) => name !== "from"), ["from", "https://elsewhere.example/"], ["staffId", "x"], ["aal", "aal1"]]))).toEqual({
      status: "started",
      location: `/staff/alerts/resolve?alert=${ALERT}&entry=${ENTRY}&saved=1`,
    });
    expect(startFinal.mock.calls[0][0]).toEqual({ staffId: session.staffId, aal: "aal2" });
  });

  it("sends nothing for a form with no words, and lets the use case refuse it", async () => {
    const { startFinal, wired } = deps({ ok: false, error: "TEXT_EMPTY" });
    expect(await startFinalFromForm(wired, session, form(base.filter(([name]) => name !== "text")))).toMatchObject({ status: "refused", message: expect.stringContaining("Write the text") });
    expect(startFinal.mock.calls[0][2].text).toBe("");
  });

  it.each([
    ["ALERT_CLOSED", "This alert is already closed."],
    ["NO_PUBLISHED_ENTRY", "Nothing is published in this alert yet"],
    ["ALERT_NOT_FOUND", "That alert draft was not found."],
    ["NOT_ALLOWED", "You cannot change or submit this alert."],
    ["OUT_OF_SCOPE", "Only the author, or someone who has changed this alert"],
  ] as const)("tells the person why a refusal of %s, in the composer's words, and stays on the form", async (error, words) => {
    const { wired } = deps({ ok: false, error });
    expect(await startFinalFromForm(wired, session, form(base))).toMatchObject({ status: "refused", message: expect.stringContaining(words) });
  });
});
