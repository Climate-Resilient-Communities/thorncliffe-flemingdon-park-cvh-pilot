// What changes in saving a draft because updates exist (S05.01): the form of an update to a running alert keeps the thread's types, the page a form was
// written on leads back to it, and the valid-until and the phase are read the one way by every form that has them.
import { describe, expect, it, vi } from "vitest";
import { UNTIL_RESOLVED_MS, type AlertRefusal, type EntryContent, type EntryView } from "@/modules/alerting";
import { contentFromForm, phaseFromForm, validUntilFromForm } from "./contentFromForm";
import { composerFromForm, composerLocation, pullBackFromForm, saveDraftFromForm, type EditDeps } from "./editDraft";

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ENTRY = "01900000-0000-7000-8000-00000000e177";
const session = { staffId: "01900000-0000-7000-8000-0000000000c1", aal: "aal2" as const };
const NOW = new Date("2026-10-04T14:00:00.000Z");

const draft: EntryContent = {
  text: "We know more now.",
  types: ["elevator", "power"],
  audience: { scope: "buildings", buildings: [{ rsn: "7001", floors: null }], groups: [], types: ["elevator", "power"] },
  phase: "in_progress",
  validUntil: new Date("2026-10-05T14:00:00.000Z"),
  validUntilMode: "resolved",
};
const form = (entries: Array<[string, string]>) => {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
};
const refs: Array<[string, string]> = [["alert", ALERT], ["entry", ENTRY]];

describe("the valid-until a form describes", () => {
  it('is "until resolved" as 24 elapsed hours from now when the form says so or says nothing, and a Toronto time otherwise', () => {
    const resolved = { ok: true, validUntil: new Date(NOW.getTime() + UNTIL_RESOLVED_MS), mode: "resolved" };
    expect(validUntilFromForm(form([["valid-mode", "resolved"]]), NOW)).toEqual(resolved);
    expect(validUntilFromForm(form([]), NOW)).toEqual(resolved);
    expect(validUntilFromForm(form([["valid-mode", "at"], ["valid-date", "2026-10-06"], ["valid-time", "17:45"]]), NOW)).toEqual({ ok: true, validUntil: new Date("2026-10-06T21:45:00.000Z"), mode: "at" });
  });

  it("says what is wrong with a time that is not one, as the composers always have", () => {
    expect(validUntilFromForm(form([["valid-mode", "at"]]), NOW)).toEqual({ ok: false, problem: { kind: "message", message: "Enter a date and a time." } });
  });
});

describe("the phase a form chose", () => {
  it("is one of the two, or nothing", () => {
    expect(phaseFromForm(form([["phase", "problem"]]))).toBe("problem");
    expect(phaseFromForm(form([["phase", "in_progress"]]))).toBe("in_progress");
    expect(phaseFromForm(form([]))).toBeNull();
    expect(phaseFromForm(form([["phase", "resolved"]]))).toBeNull();
    expect(phaseFromForm(form([["phase", ""]]))).toBeNull();
  });
});

describe("the types of an update to a running alert", () => {
  it("are the draft's own whatever the form sends: a form that ticks other types, or none, changes nothing", () => {
    const tampered = form([["types-sent", "1"], ["type", "water"], ["valid-mode", "resolved"]]);
    const kept = contentFromForm(tampered, draft, NOW, { keepTypes: true });
    expect(kept.ok && kept.content.types).toEqual(["elevator", "power"]);
    expect(kept.ok && kept.content.audience.types).toEqual(["elevator", "power"]);
    const none = contentFromForm(form([["types-sent", "1"]]), draft, NOW, { keepTypes: true });
    expect(none.ok && none.content.types).toEqual(["elevator", "power"]);
  });

  it("are read from the form as before for the composers that have them (the alert composer)", () => {
    const read = contentFromForm(form([["types-sent", "1"], ["type", "water"]]), draft, NOW);
    expect(read.ok && read.content.types).toEqual(["water"]);
  });

  it("keep the phase the form chose, and the draft's own when it chose none", () => {
    const chosen = contentFromForm(form([["phase", "problem"]]), draft, NOW, { keepTypes: true });
    expect(chosen.ok && chosen.content.phase).toBe("problem");
    const none = contentFromForm(form([]), draft, NOW, { keepTypes: true });
    expect(none.ok && none.content.phase).toBe("in_progress");
  });
});

describe("the composer a form was written on", () => {
  it("is named by the form's own field, and only one of the four is believed", () => {
    for (const from of ["ack", "compose", "update", "promote"]) expect(composerFromForm(form([["from", from]]))).toBe(from);
    for (const from of ["", "approve", "/staff", "https://elsewhere.example/", "__proto__"]) expect(composerFromForm(form([["from", from]]))).toBeNull();
    expect(composerFromForm(form([]))).toBeNull();
  });

  it("is where a saved draft goes back to: the page the form says, else the page of the entry's kind", () => {
    const ref = { alertId: ALERT, entryId: ENTRY };
    expect(composerLocation("update", ref, { saved: "1" }, "update")).toBe(`/staff/alerts/update?alert=${ALERT}&entry=${ENTRY}&saved=1`);
    expect(composerLocation("update", ref, {}, "promote")).toBe(`/staff/alerts/promote?alert=${ALERT}&entry=${ENTRY}`);
    expect(composerLocation("update", ref, {}, "compose")).toBe(`/staff/alerts/compose?alert=${ALERT}&entry=${ENTRY}`);
    expect(composerLocation("update", ref, {}, null)).toBe(`/staff/alerts/compose?alert=${ALERT}&entry=${ENTRY}`);
    expect(composerLocation("ack", ref)).toBe(`/staff/alerts/ack?alert=${ALERT}&entry=${ENTRY}`);
  });
});

describe("saving and pulling back an update from its composer", () => {
  const entry = { id: ENTRY, alertId: ALERT, kind: "update", content: draft } as unknown as EntryView;
  function deps(save: { ok: true } | { ok: false; error: AlertRefusal } = { ok: true }) {
    const getEntry = vi.fn(async () => entry);
    const saveDraft = vi.fn<(actor: unknown, ref: unknown, content: EntryContent) => Promise<unknown>>(async (_actor, _ref, content) => (save.ok ? { ok: true as const, value: { ...entry, content } } : save));
    const returnEntry = vi.fn<(actor: unknown, ref: unknown, why: string) => Promise<unknown>>(async () => ({ ok: true as const, value: entry }));
    const wired: EditDeps = { alerting: () => ({ getEntry, saveDraft, returnEntry }) as unknown as ReturnType<EditDeps["alerting"]>, now: () => NOW };
    return { saveDraft, returnEntry, wired };
  }

  it("keeps the thread's types and goes back to the update composer, with the notice that it was saved", async () => {
    const { saveDraft, wired } = deps();
    const state = await saveDraftFromForm(wired, session, form([...refs, ["from", "update"], ["text", "Better words."], ["phase", "problem"], ["valid-mode", "resolved"], ["types-sent", "1"], ["type", "water"]]));
    expect(state).toMatchObject({ status: "saved", location: `/staff/alerts/update?alert=${ALERT}&entry=${ENTRY}&saved=1` });
    const saved = saveDraft.mock.calls[0][2];
    expect(saved).toMatchObject({ text: "Better words.", phase: "problem", types: ["elevator", "power"] });
  });

  it("goes back to the promotion composer for a promotion, and a save that is the first half of a submit stays where it is", async () => {
    const { wired } = deps();
    expect(await saveDraftFromForm(wired, session, form([...refs, ["from", "promote"], ["valid-mode", "resolved"], ["then", "submit"]]))).toMatchObject({ status: "saved", location: `/staff/alerts/promote?alert=${ALERT}&entry=${ENTRY}` });
  });

  it("lets the alert composer keep changing its types: the thread's first entry has none to keep", async () => {
    const { saveDraft, wired } = deps();
    await saveDraftFromForm(wired, session, form([...refs, ["from", "compose"], ["valid-mode", "resolved"], ["types-sent", "1"], ["type", "water"]]));
    expect(saveDraft.mock.calls[0][2]).toMatchObject({ types: ["water"] });
  });

  it("tells the person why a refusal of the use case happened, in the words of the update's: the thread changed its types, or closed", async () => {
    for (const [error, words] of [["TYPES_CHANGED", "keeps the types of the alert"], ["ALERT_CLOSED", "This alert is already closed."]] as const) {
      const { wired } = deps({ ok: false, error });
      expect(await saveDraftFromForm(wired, session, form([...refs, ["from", "update"], ["valid-mode", "resolved"]]))).toMatchObject({ status: "refused", message: expect.stringContaining(words) });
    }
  });

  it("pulls a submitted update back to the composer the form came from", async () => {
    const { returnEntry, wired } = deps();
    const state = await pullBackFromForm(wired, session, form([...refs, ["from", "promote"]]));
    expect(state).toEqual({ status: "pulled_back", location: `/staff/alerts/promote?alert=${ALERT}&entry=${ENTRY}` });
    expect(returnEntry.mock.calls[0][2]).toBe("edit");
  });
});
