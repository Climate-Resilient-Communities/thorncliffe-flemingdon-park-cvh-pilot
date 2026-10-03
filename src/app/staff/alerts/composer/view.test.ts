import { describe, expect, it } from "vitest";
import { BUILDING_TYPES } from "@/contracts/alertContent";
import { ALERT_TEXT_MAX, type EntryState } from "@/modules/alerting";
import type { RenderedSms } from "@/modules/messaging";
import type { BuildingFloorPlan } from "@/modules/places";
import { MESSAGE_CODES, catalogText, composerScreen, missingComposer, type ComposerInput } from "./view";

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ENTRY = "01900000-0000-7000-8000-00000000e177";
const OTHER = "01900000-0000-7000-8000-00000000e178";
const KEY = "0f0e0d0c-0b0a-4908-8706-050403020100";
const NOW = new Date("2026-10-04T14:00:00.000Z");
const FLOOR = "01900000-0000-7000-8000-000000000f01";

const PLANS: BuildingFloorPlan[] = [
  { rsn: "7001", address: "45 Thorncliffe Park Dr", neighbourhoodId: "TP", neighbourhoodName: "Thorncliffe Park", floors: [{ id: FLOOR, label: "G", sortOrder: 0 }] },
];

type Overrides = {
  entry?: Partial<EntryState["entry"]>;
  attempt?: Partial<NonNullable<EntryState["attempt"]>> | null;
  translations?: EntryState["translations"];
  types?: string[];
};

function stateOf(overrides: Overrides = {}): EntryState {
  const types = overrides.types ?? ["elevator"];
  return {
    thread: { id: ALERT, slug: "abcd2345", isDrill: false, reportedAt: new Date("2026-10-04T13:30:00.000Z"), status: "open" },
    entry: {
      id: ENTRY,
      alertId: ALERT,
      kind: "ack",
      status: "draft",
      authorId: "01900000-0000-7000-8000-0000000000c1",
      editorIds: [],
      content: {
        text: "The elevator at 45 Thorncliffe Park Dr is out of service.",
        types,
        audience: { scope: "buildings", buildings: [{ rsn: "7001", floors: null }], groups: ["seniors"], types },
        phase: "problem",
        validUntil: new Date("2026-10-05T14:00:00.000Z"),
      },
      version: 0,
      contentHash: null,
      submittedAt: null,
      returnedFor: null,
      approvedBy: null,
      approvedAt: null,
      webPublishedAt: null,
      possibleDuplicateOf: null,
      ...overrides.entry,
    } as EntryState["entry"],
    attempt:
      overrides.attempt === undefined || overrides.attempt === null
        ? null
        : {
            key: KEY,
            kind: "submit",
            state: "running",
            outcome: null,
            startedAt: new Date("2026-10-04T13:59:10.000Z"),
            finishedAt: null,
            budgetMs: 35000,
            progress: {},
            resultVersion: null,
            resultHash: null,
            ...overrides.attempt,
          },
    translations: overrides.translations ?? [],
  };
}

const SMS: RenderedSms = { body: "Thorncliffe Flemingdon Hub: The elevator is out.\nhttps://example.test/a/abcd2345", encoding: "gsm7", segments: 1 };

const input = (overrides: Partial<ComposerInput> & { state?: EntryState } = {}): ComposerInput => ({
  mode: "ack",
  state: overrides.state ?? stateOf(),
  plans: PLANS,
  preview: { sms: SMS, nineOneOneFirst: false },
  saved: false,
  now: NOW,
  ...overrides,
});

const FROZEN: EntryState["translations"] = [
  { lang: "fr", status: "translated", machine: true },
  { lang: "ur", status: "fallback_en", machine: false },
  { lang: "ps", status: "fallback_en", machine: false },
  { lang: "zh-Hant", status: "script_converted", machine: true },
];

describe("a draft", () => {
  it("is the acknowledgement composer for an ack: the text, the valid-until, the types as a summary and not as choices", () => {
    const screen = composerScreen(input());
    expect(screen.status).toBe("draft");
    expect(screen.title).toBe("Acknowledge the disruption");
    expect(screen.draft?.types).toBeNull();
    expect(screen.draft?.phase).toBeNull();
    expect(screen.draft?.typesSummary).toBe("Elevator");
    expect(screen.draft?.text).toMatchObject({ value: "The elevator at 45 Thorncliffe Park Dr is out of service.", max: ALERT_TEXT_MAX });
    expect(screen.draft?.text.counter).toContain("{n}");
    expect(screen.firstReport).toBe("First report: Sunday, October 4, 2026 at 9:30 a.m. EDT");
    expect(screen.here).toBe(`/staff/alerts/ack?alert=${ALERT}&entry=${ENTRY}`);
    expect(screen.pending).toBeUndefined();
    expect(screen.locked).toBeUndefined();
  });

  it("is the alert composer for an update, with the types and where things stand as choices, the entry's own ticked", () => {
    const screen = composerScreen(input({ mode: "alert", state: stateOf({ entry: { kind: "update" }, types: ["elevator", "power"] }) }));
    expect(screen.title).toBe("Write an alert");
    // The choices are in the order O-11 lists the types (power first), whatever order the entry holds them in.
    expect(screen.draft?.types?.building.map((choice) => choice.id)).toEqual([...BUILDING_TYPES]);
    expect(screen.draft?.types?.building.filter((choice) => choice.checked).map((choice) => choice.id).sort()).toEqual(["elevator", "power"]);
    expect(screen.draft?.types?.neighbourhood.map((choice) => choice.id)).toEqual(["heat", "smoke", "winter"]);
    expect(screen.draft?.types?.neighbourhood.every((choice) => !choice.checked)).toBe(true);
    expect(screen.draft?.phase?.items).toEqual([
      { id: "problem", label: expect.any(String), checked: true },
      { id: "in_progress", label: expect.any(String), checked: false },
    ]);
    expect(screen.here).toBe(`/staff/alerts/compose?alert=${ALERT}&entry=${ENTRY}`);
  });

  it("shows the valid-until as a Toronto date and time", () => {
    const screen = composerScreen(input({ state: stateOf() }));
    expect(screen.draft?.valid.fields).toEqual({ date: "2026-10-05", time: "10:00", fold: "" });
    expect(screen.draft?.valid.mode).toBe("at");
  });

  it("opens on how the author chose the valid-until: 'until resolved' is remembered, a date and time is the default", () => {
    const resolved = stateOf();
    (resolved.entry.content as { validUntilMode?: string }).validUntilMode = "resolved";
    expect(composerScreen(input({ state: resolved })).draft?.valid.mode).toBe("resolved");
    const at = stateOf();
    (at.entry.content as { validUntilMode?: string }).validUntilMode = "at";
    expect(composerScreen(input({ state: at })).draft?.valid.mode).toBe("at");
  });

  it("carries the answer to the clock-change question for a stored valid-until in the repeated autumn hour, so saving again does not ask again", () => {
    for (const [iso, fold] of [["2026-11-01T05:30:00.000Z", "before"], ["2026-11-01T06:30:00.000Z", "after"]] as const) {
      const state = stateOf();
      state.entry.content = { ...state.entry.content, validUntil: new Date(iso) };
      expect(composerScreen(input({ state })).draft?.valid.fields, iso).toEqual({ date: "2026-11-01", time: "01:30", fold });
    }
  });

  it("names the key of the entry's latest attempt, whatever became of it, so a key the browser kept can be told confirmed", () => {
    expect(composerScreen(input()).lastAttemptKey).toBeNull();
    expect(composerScreen(input({ state: stateOf({ attempt: { state: "failed", outcome: "ROUTES_UNAVAILABLE", finishedAt: NOW } }) })).lastAttemptKey).toBe(KEY);
    expect(composerScreen(input({ state: stateOf({ attempt: {} }) })).lastAttemptKey).toBe(KEY);
  });

  it("lists the fifteen texts that are translated, in the launch order then Traditional Chinese, each waiting, none of them English", () => {
    const rows = composerScreen(input()).languages.rows;
    expect(rows).toHaveLength(15);
    expect(rows.at(-1)?.lang).toBe("zh-Hant");
    expect(rows.map((row) => row.lang)).not.toContain("en");
    expect(new Set(rows.map((row) => row.lang)).size).toBe(15);
    expect(rows.every((row) => row.state === "waiting")).toBe(true);
    expect(new Set(rows.map((row) => row.stateLabel)).size).toBe(1);
    // Urdu is drawn right to left in its own script.
    expect(rows.find((row) => row.lang === "ur")).toMatchObject({ dir: "rtl", bcp47: expect.stringMatching(/^ur/) });
  });

  it("previews the English text message, line by line, with the encoding, and says where the 911 line goes", () => {
    const screen = composerScreen(input());
    expect(screen.preview).toMatchObject({ lines: SMS.body.split("\n"), segments: 1, note: expect.stringContaining("after the text") });
    expect(screen.preview?.lead).toContain("standard characters");
    expect(composerScreen(input({ preview: { sms: { ...SMS, encoding: "ucs2", segments: 3 }, nineOneOneFirst: true } })).preview).toMatchObject({ segments: 3, note: expect.stringContaining("comes first") });
    expect(composerScreen(input({ preview: null })).preview).toBeNull();
  });

  it("says the draft is saved only after the Save button, and only for a draft", () => {
    expect(composerScreen(input({ saved: true })).notice).toBe("The draft is saved.");
    expect(composerScreen(input()).notice).toBeUndefined();
    expect(composerScreen(input({ saved: true, state: stateOf({ entry: { status: "pending_approval", version: 1, contentHash: "a".repeat(64) } }) })).notice).toBeUndefined();
  });

  it("says the audience in words and links to the place and group pages with the way back to this composer", () => {
    const screen = composerScreen(input());
    expect(screen.aside.sentence).toContain("45 Thorncliffe Park Dr");
    expect(screen.aside.link.href).toBe(`/staff/alerts/audience?alert=${ALERT}&entry=${ENTRY}&from=ack`);
    expect(screen.aside.groupsLink.href).toBe(`/staff/alerts/audience/groups?alert=${ALERT}&entry=${ENTRY}&from=ack`);
    expect(composerScreen(input({ mode: "alert" })).aside.link.href).toMatch(/&from=compose$/);
    expect(screen.aside.channels).toHaveLength(2);
  });
});

describe("a draft after an attempt", () => {
  it("resumes a running attempt with its key, its budget and the languages that have settled", () => {
    const screen = composerScreen(input({ state: stateOf({ attempt: { state: "running", progress: { fr: "translated", ur: "fallback_en" } } }) }));
    expect(screen.resume).toEqual({ key: KEY, kind: "submit", budgetMs: 35000, progress: { fr: "translated", ur: "fallback_en" } });
    expect(screen.languages.rows.find((row) => row.lang === "fr")).toMatchObject({ state: "translated" });
    expect(screen.languages.rows.find((row) => row.lang === "ur")).toMatchObject({ state: "fallback_en" });
    expect(screen.languages.rows.find((row) => row.lang === "ta")).toMatchObject({ state: "waiting" });
  });

  it("has nothing to resume when no attempt runs", () => {
    expect(composerScreen(input()).resume).toBeNull();
    expect(composerScreen(input({ state: stateOf({ attempt: { state: "committed", resultVersion: 1 } }) })).resume).toBeNull();
  });

  it("says why the last attempt failed, on the draft it left, in words, not as a code", () => {
    for (const code of ["ROUTES_UNAVAILABLE", "SMS_BODY_TOO_LONG", "SUBMIT_ABANDONED", "TRANSLATION_STALE"] as const) {
      const screen = composerScreen(input({ state: stateOf({ attempt: { state: "failed", outcome: code, finishedAt: NOW } }) }));
      expect(screen.failure, code).toBe(screen.messages.errors[code]);
      expect(screen.failure, code).not.toMatch(/^[A-Z_]+$/);
    }
  });

  it("does not repeat a failure after the author saved a change, and shows none for an attempt that succeeded", () => {
    expect(composerScreen(input({ saved: true, state: stateOf({ attempt: { state: "failed", outcome: "ROUTES_UNAVAILABLE", finishedAt: NOW } }) })).failure).toBeUndefined();
    expect(composerScreen(input({ state: stateOf({ attempt: { state: "committed", resultVersion: 1 } }) })).failure).toBeUndefined();
  });
});

describe("a submitted entry", () => {
  const pending = (translations: EntryState["translations"], overrides: Overrides = {}) =>
    composerScreen(input({ state: stateOf({ entry: { status: "pending_approval", version: 2, contentHash: "d".repeat(64), submittedAt: NOW, ...overrides.entry }, translations, attempt: { state: "committed", resultVersion: 2, finishedAt: NOW } }) }));

  it("has the version, the hash that Try translation again names, and no form", () => {
    const screen = pending(FROZEN);
    expect(screen.status).toBe("pending");
    expect(screen.draft).toBeUndefined();
    expect(screen.pending).toMatchObject({ version: 2, contentHash: "d".repeat(64) });
    expect(screen.pending?.lead).toContain("Version 2");
    expect(screen.resume).toBeNull();
  });

  it("names the languages that fell back and offers Try translation again for them", () => {
    const screen = pending(FROZEN);
    expect(screen.pending?.fallback?.summary).toContain("2 of 15 languages");
    expect(screen.pending?.fallback?.summary).toContain("Urdu and Pashto");
    expect(screen.pending?.allTranslated).toBeNull();
    expect(screen.languages.rows.find((row) => row.lang === "zh-Hant")).toMatchObject({ state: "script_converted", stateLabel: "Converted from Mandarin" });
    expect(screen.languages.rows.find((row) => row.lang === "ur")?.stateLabel).toContain("Translation not available");
  });

  it("says every language was translated when none fell back, and then offers no retry", () => {
    const screen = pending([{ lang: "fr", status: "translated", machine: true }]);
    expect(screen.pending?.fallback).toBeNull();
    expect(screen.pending?.allTranslated).toBe("Every language was translated.");
  });

  it("shows the possible duplicate only when the entry has one", () => {
    expect(pending(FROZEN, { entry: { possibleDuplicateOf: OTHER } }).pending?.duplicate).toContain("may duplicate");
    expect(pending(FROZEN).pending?.duplicate).toBeNull();
  });

  it("does not show the preview of the saved draft once the entry is frozen", () => {
    // The page passes no preview for an entry that is not a draft.
    expect(composerScreen(input({ preview: null, state: stateOf({ entry: { status: "pending_approval", version: 1, contentHash: "a".repeat(64) } }) })).preview).toBeNull();
  });
});

describe("an entry that can no longer be changed here", () => {
  it("says why in a note, with no form and no pending panel", () => {
    for (const [status, words] of [
      ["approved", "approved and is published"],
      ["discarded", "was discarded"],
      ["superseded", "is closed"],
    ] as const) {
      const screen = composerScreen(input({ preview: null, state: stateOf({ entry: { status } }) }));
      expect(screen.status, status).toBe("locked");
      expect(screen.locked, status).toContain(words);
      expect(screen.draft).toBeUndefined();
      expect(screen.pending).toBeUndefined();
    }
  });
});

describe("the words the screen carries for the browser", () => {
  const { messages } = composerScreen(input());

  it("has a sentence for every code a press can end with, none of them a code, and a catch-all", () => {
    for (const code of MESSAGE_CODES) {
      expect(messages.errors[code], code).toBeTruthy();
      expect(messages.errors[code], code).not.toMatch(/^[A-Z_]+$/);
    }
    // It does not claim that nothing was submitted: the request may still be on its way, and the same key is sent again.
    expect(messages.errors.NOT_REACHED).toContain("could not confirm that the request reached the server");
    expect(messages.errors.NOT_REACHED).not.toContain("nothing was submitted");
    expect(messages.errors.invalid).toBeTruthy();
  });

  it("fills the text limit into the sentence about it, and leaves the running sentences as templates for the browser to fill", () => {
    expect(messages.errors.TEXT_TOO_LONG).toContain(String(ALERT_TEXT_MAX));
    expect(messages.running.lead).toContain("{seconds}");
    expect(messages.running.summary).toContain("{done}");
    expect(messages.running.summary).toContain("{total}");
  });

  it("is the same words each time (the catalog, nothing computed)", () => {
    expect(composerScreen(input()).messages).toEqual(messages);
    expect(catalogText("save")).toBe("Save draft");
  });
});

describe("the entry that is not there", () => {
  it("says so and offers the way back to the Hub", () => {
    expect(missingComposer()).toEqual({ kind: "missing", message: expect.stringContaining("not found"), back: { href: "/staff", label: "Back to the Hub" } });
  });
});
