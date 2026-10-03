import { describe, expect, it, vi } from "vitest";
import { draftFingerprint, type AlertRefusal, type EntryContent, type EntryView } from "@/modules/alerting";
import { composeRefusalMessage, composerLocation, pullBackFromForm, saveDraftFromForm, type EditDeps } from "./editDraft";

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ENTRY = "01900000-0000-7000-8000-00000000e177";
const session = { staffId: "01900000-0000-7000-8000-0000000000c1", aal: "aal2" as const };
const NOW = new Date("2026-10-04T14:00:00.000Z");

const content: EntryContent = {
  text: "We know about it.",
  types: ["elevator"],
  audience: { scope: "buildings", buildings: [{ rsn: "7001", floors: "all" }], groups: [], types: ["elevator"] },
  phase: "problem",
  validUntil: new Date("2026-10-05T14:00:00.000Z"),
} as unknown as EntryContent;

const entryOf = (kind: "ack" | "update"): EntryView => ({ id: ENTRY, alertId: ALERT, kind, content }) as unknown as EntryView;

function deps(options: { entry?: EntryView | null; save?: { ok: true } | { ok: false; error: AlertRefusal }; back?: { ok: true; kind: string } | { ok: false; error: AlertRefusal } } = {}) {
  const getEntry = vi.fn(async () => (options.entry === undefined ? entryOf("ack") : options.entry));
  const saveDraft = vi.fn<(actor: unknown, ref: unknown, content: EntryContent) => Promise<unknown>>(async () => {
    const save = options.save ?? { ok: true as const };
    return save.ok ? { ok: true as const, value: entryOf("ack") } : save;
  });
  const returnEntry = vi.fn<(actor: unknown, ref: unknown, why: string) => Promise<unknown>>(async () => {
    const back = options.back ?? { ok: true as const, kind: "ack" };
    return back.ok ? { ok: true as const, value: entryOf(back.kind === "update" ? "update" : "ack") } : back;
  });
  const wired: EditDeps = { alerting: () => ({ getEntry, saveDraft, returnEntry }) as unknown as ReturnType<EditDeps["alerting"]>, now: () => NOW };
  return { getEntry, saveDraft, returnEntry, wired };
}

const form = (entries: Array<[string, string]>) => {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
};
const refs: Array<[string, string]> = [["alert", ALERT], ["entry", ENTRY]];

describe("composerLocation", () => {
  it("is the acknowledgement composer for an acknowledgement and the alert composer for anything else", () => {
    expect(composerLocation("ack", { alertId: ALERT, entryId: ENTRY })).toBe(`/staff/alerts/ack?alert=${ALERT}&entry=${ENTRY}`);
    expect(composerLocation("update", { alertId: ALERT, entryId: ENTRY }, { saved: "1" })).toBe(`/staff/alerts/compose?alert=${ALERT}&entry=${ENTRY}&saved=1`);
  });
});

describe("composeRefusalMessage", () => {
  it("is the composer's own wording where it has some, and a general line otherwise", () => {
    expect(composeRefusalMessage("TEXT_TOO_LONG")).toContain("600");
    expect(composeRefusalMessage("VALID_UNTIL_PAST")).not.toBe(composeRefusalMessage("TEXT_TOO_LONG"));
    expect(composeRefusalMessage("NOT_A_REFUSAL")).toBe(composeRefusalMessage("ALSO_NOT_ONE"));
    expect(composeRefusalMessage("NOT_A_REFUSAL").length).toBeGreaterThan(0);
  });

  it("has words for the refusals a save can end with", () => {
    for (const reason of ["TEXT_EMPTY", "TEXT_TOO_LONG", "VALID_UNTIL_PAST", "VALID_UNTIL_TOO_FAR", "VALID_UNTIL_INVALID", "ENTRY_NOT_FOUND", "OUT_OF_SCOPE", "ILLEGAL_TRANSITION"] as const) {
      expect(composeRefusalMessage(reason), reason).not.toBe(composeRefusalMessage("NOT_A_REFUSAL"));
    }
  });

  it("has its own words for every way a submit can end without freezing the entry, each different from the others", () => {
    const submit = [
      "DRAFT_CHANGED",
      "SMS_BODY_TOO_LONG",
      "TRANSLATION_STALE",
      "ROUTES_UNAVAILABLE",
      "ROUTES_INVALID",
      "SUBMIT_IN_PROGRESS",
      "SUBMIT_KEY_INVALID",
      "SUBMIT_ABANDONED",
      "PREPARATION_FAILED",
    ] as const;
    const messages = submit.map((reason) => composeRefusalMessage(reason));
    expect(new Set(messages).size).toBe(submit.length);
    for (const message of messages) expect(message).not.toBe(composeRefusalMessage("NOT_A_REFUSAL"));
  });
});

describe("saving the draft from the composer's form", () => {
  it("saves what the form changed and reloads the composer with 'saved' for the Save button", async () => {
    const { saveDraft, wired } = deps();
    const state = await saveDraftFromForm(wired, session, form([...refs, ["text", "The elevator is out."], ["valid-mode", "resolved"]]));

    expect(state).toEqual({ status: "saved", location: `/staff/alerts/ack?alert=${ALERT}&entry=${ENTRY}&saved=1`, fingerprint: draftFingerprint(content) });
    const [actor, ref, saved] = saveDraft.mock.calls[0];
    expect(actor).toEqual(session);
    expect(ref).toEqual({ alertId: ALERT, entryId: ENTRY });
    expect(saved.text).toBe("The elevator is out.");
    expect(saved.validUntil).toEqual(new Date(NOW.getTime() + 24 * 60 * 60 * 1000));
  });

  it("stays where it is when it is the first half of a submit", async () => {
    const { wired } = deps();
    const state = await saveDraftFromForm(wired, session, form([...refs, ["text", "x"], ["then", "submit"]]));
    expect(state).toEqual({ status: "saved", location: `/staff/alerts/ack?alert=${ALERT}&entry=${ENTRY}`, fingerprint: draftFingerprint(content) });
  });

  it("answers with the fingerprint of the draft as saved, which a submit then names", async () => {
    const saved = { ...content, text: "Saved text." } as EntryContent;
    const { wired } = deps();
    wired.alerting = () => ({ getEntry: async () => entryOf("ack"), saveDraft: async () => ({ ok: true as const, value: { ...entryOf("ack"), content: saved } }), returnEntry: async () => ({ ok: false as const, error: "NOT_ALLOWED" as const }) }) as unknown as ReturnType<EditDeps["alerting"]>;

    const state = await saveDraftFromForm(wired, session, form([...refs, ["text", "Saved text."], ["then", "submit"]]));

    expect(state).toMatchObject({ status: "saved", fingerprint: draftFingerprint(saved) });
    expect(draftFingerprint(saved)).not.toBe(draftFingerprint(content));
  });

  it("goes back to the alert composer for an update", async () => {
    const { wired } = deps({ entry: entryOf("update") });
    const state = await saveDraftFromForm(wired, session, form([...refs, ["text", "x"]]));
    expect(state).toMatchObject({ status: "saved", location: expect.stringMatching(/^\/staff\/alerts\/compose\?/) });
  });

  it("refuses a draft that is not there without saving anything", async () => {
    const { saveDraft, wired } = deps({ entry: null });
    expect(await saveDraftFromForm(wired, session, form([...refs, ["text", "x"]]))).toEqual({ status: "refused", message: composeRefusalMessage("ENTRY_NOT_FOUND") });
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("tells the person what the use case refused, without reloading", async () => {
    const { wired } = deps({ save: { ok: false, error: "TEXT_TOO_LONG" } });
    expect(await saveDraftFromForm(wired, session, form([...refs, ["text", "x".repeat(700)]]))).toEqual({ status: "refused", message: composeRefusalMessage("TEXT_TOO_LONG") });
  });

  it("does not save a valid-until that cannot be read, and says why", async () => {
    const { saveDraft, wired } = deps();
    expect(await saveDraftFromForm(wired, session, form([...refs, ["valid-mode", "at"], ["valid-date", "2026-03-08"], ["valid-time", "02:30"]]))).toMatchObject({ status: "refused" });
    expect(await saveDraftFromForm(wired, session, form([...refs, ["valid-mode", "at"], ["valid-date", ""], ["valid-time", ""]]))).toMatchObject({ status: "refused" });
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("asks before or after for a valid-until in the repeated hour, without saving", async () => {
    const { saveDraft, wired } = deps();
    const state = await saveDraftFromForm(wired, session, form([...refs, ["valid-mode", "at"], ["valid-date", "2026-11-01"], ["valid-time", "01:30"]]));
    expect(state).toMatchObject({ status: "ask", question: expect.stringContaining("happens twice") });
    expect(saveDraft).not.toHaveBeenCalled();
  });
});

describe("pulling a submitted entry back to edit", () => {
  it("returns it for editing and goes to the composer of its kind", async () => {
    const { returnEntry, wired } = deps({ back: { ok: true, kind: "update" } });
    const state = await pullBackFromForm(wired, session, form(refs));
    expect(state).toEqual({ status: "pulled_back", location: `/staff/alerts/compose?alert=${ALERT}&entry=${ENTRY}` });
    expect(returnEntry.mock.calls[0]).toEqual([session, { alertId: ALERT, entryId: ENTRY }, "edit"]);
  });

  it("tells the person what the use case refused", async () => {
    const { wired } = deps({ back: { ok: false, error: "ENTRY_NOT_FOUND" } });
    expect(await pullBackFromForm(wired, session, form(refs))).toEqual({ status: "refused", message: composeRefusalMessage("ENTRY_NOT_FOUND") });
  });
});
