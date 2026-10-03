// "Correct" and "Withdraw" (O-15, S05.02), the view model and how it is drawn: the entries that can be corrected or withdrawn, each a link that chooses it; for a
// correction the chosen entry's words to change, where things stand and the valid-until, with who it is for carried over from the alert; for a withdrawal the
// reason from the catalog and the words for residents; the entry being replaced shown as residents read it; and the composer of the draft each makes.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Audience } from "@/contracts/audience";
import { updateStart, type EntryState, type ThreadEntrySummary, type ThreadSummary } from "@/modules/alerting";
import type { BuildingFloorPlan } from "@/modules/places";
import { ComposerBody, type ComposerActions } from "../composer/ComposerBody";
import { composerScreen, replaceStartScreen, type ComposerScreen } from "../composer/view";

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ACK = "01900000-0000-7000-8000-00000000e100";
const UPDATE = "01900000-0000-7000-8000-00000000e101";
const DRAFT = "01900000-0000-7000-8000-00000000e177";
const NEW_ENTRY = "01900000-0000-7000-8000-00000000e999";
const NOW = new Date("2026-10-04T16:00:00.000Z");
const floorId = (index: number) => `01900000-0000-7000-8000-00007001${String(index).padStart(4, "0")}`;

const PLANS: BuildingFloorPlan[] = [
  { rsn: "7001", address: "45 Thorncliffe Park Dr", neighbourhoodId: "TP", neighbourhoodName: "Thorncliffe Park", floors: ["G", "1", "2", "3", "4"].map((label, index) => ({ id: floorId(index), label, sortOrder: index })) },
];
const AUDIENCE: Audience = { scope: "buildings", buildings: [{ rsn: "7001", floors: [floorId(3), floorId(4)] }], groups: ["seniors"], types: ["elevator"] };

function published(id: string, kind: ThreadEntrySummary["kind"], minutes: number, over: Partial<ThreadEntrySummary> = {}): ThreadEntrySummary {
  return {
    id,
    kind,
    status: "approved",
    webPublishedAt: new Date(Date.UTC(2026, 9, 4, 14, minutes, 0)),
    phase: "problem",
    validUntil: new Date("2026-10-05T14:00:00.000Z"),
    validUntilMode: "at",
    audience: AUDIENCE,
    types: ["elevator"],
    text: `${kind} at ${minutes}`,
    version: 1,
    ...over,
  };
}

const ENTRIES = [published(UPDATE, "update", 40, { phase: "in_progress", text: "Power is back on floors 1 to 4." }), published(ACK, "ack", 5, { text: "The elevator is out." })];
const SUMMARY: ThreadSummary = {
  thread: { id: ALERT, slug: "abcd2345", isDrill: false, reportedAt: new Date("2026-10-04T13:30:00.000Z"), status: "open" },
  entries: ENTRIES,
  covering: ENTRIES[0],
  validUntil: ENTRIES[0].validUntil,
  ackOnly: false,
};

const start = (mode: "correct" | "withdraw", target: ThreadEntrySummary | null) =>
  replaceStartScreen({ mode, alertId: ALERT, entryId: NEW_ENTRY, thread: SUMMARY, targets: ENTRIES, target, start: mode === "correct" ? updateStart(SUMMARY.covering!, NOW) : null, plans: PLANS });

const noop = async () => ({ status: "idle" as const });
const actions: ComposerActions = { save: noop, pullBack: noop, start: noop };
const html = (screen: ComposerScreen) => renderToStaticMarkup(<ComposerBody screen={screen} actions={actions} />);

function stateOf(kind: "correction" | "withdrawal", entry: Record<string, unknown> = {}): EntryState {
  return {
    thread: SUMMARY.thread,
    entry: {
      id: DRAFT,
      alertId: ALERT,
      kind,
      status: "draft",
      authorId: "01900000-0000-7000-8000-0000000000c1",
      editorIds: [],
      content: { text: "Power is out on floors 1 to 8.", types: ["elevator"], audience: AUDIENCE, phase: "problem", validUntil: new Date("2026-10-05T16:00:00.000Z"), validUntilMode: "at" },
      version: 0,
      contentHash: null,
      submittedAt: null,
      returnedFor: null,
      returnedNote: null,
      approvedBy: null,
      approvedAt: null,
      webPublishedAt: null,
      possibleDuplicateOf: null,
      supersedesId: ACK,
      withdrawalReason: kind === "withdrawal" ? "wrong_place" : null,
      ...entry,
    } as EntryState["entry"],
    attempt: null,
    translations: [],
    priorKinds: ["ack", "update"],
  };
}
const saved = (mode: "correct" | "withdraw", state: EntryState) =>
  composerScreen({ mode, state, plans: PLANS, preview: null, saved: false, now: NOW, thread: SUMMARY, target: { kind: "ack", publishedAt: ENTRIES[1].webPublishedAt, text: "The elevator is out." } });

describe("choosing the entry to correct (O-15)", () => {
  const screen = start("correct", null);

  it("lists the entries residents can read, newest first, each a link that chooses it, and makes nothing yet", () => {
    expect(screen).toMatchObject({ mode: "correct", from: "correct", status: "new", title: "Correct an alert", ref: { alertId: ALERT, entryId: NEW_ENTRY } });
    expect(screen.targets?.title).toBe("1. Which entry needs correcting?");
    expect(screen.targets?.items.map((item) => [item.key, item.heading, item.text, item.selected, item.href])).toEqual([
      [UPDATE, expect.stringMatching(/^Update, /), "Power is back on floors 1 to 4.", false, `/staff/alerts/correct?alert=${ALERT}&target=${UPDATE}`],
      [ACK, expect.stringMatching(/^Acknowledgement, /), "The elevator is out.", false, `/staff/alerts/correct?alert=${ALERT}&target=${ACK}`],
    ]);
    expect(screen.draft).toBeUndefined();
    expect(screen.replaces).toBeUndefined();
    expect(screen.startNote).toBeUndefined();
  });

  it("is drawn as the list with no form and no action to press, and the running alert above", () => {
    const out = html(screen);
    expect(out).toContain('data-testid="targets"');
    expect(out.match(/data-testid="target-choose"/g)).toHaveLength(2);
    expect(out).toContain('data-testid="thread-digest"');
    expect(out).not.toContain('name="text"');
    expect(out).not.toContain('data-testid="save-draft"');
  });

  it("says so when nothing can be corrected", () => {
    const empty = replaceStartScreen({ mode: "correct", alertId: ALERT, entryId: NEW_ENTRY, thread: SUMMARY, targets: [], target: null, start: updateStart(SUMMARY.covering!, NOW), plans: PLANS });
    expect(empty.targets?.none).toBe("No entry of this alert can be corrected or withdrawn now.");
    expect(html(empty)).toContain('data-testid="targets-none"');
  });
});

describe("correcting the chosen entry (O-15)", () => {
  const screen = start("correct", ENTRIES[1]);

  it("starts from the entry's own words, with the entry shown as residents read it, and marks the chosen one", () => {
    expect(screen.draft?.text).toMatchObject({ label: "2. The corrected wording", value: "The elevator is out." });
    expect(screen.replaces).toMatchObject({ title: "The entry residents read now", text: "The elevator is out.", heading: expect.stringMatching(/^Acknowledgement, /) });
    expect(screen.targetId).toBe(ACK);
    expect(screen.targets?.items.map((item) => item.selected)).toEqual([false, true]);
    expect(screen.startNote).toContain("Saving makes the draft.");
  });

  it("needs the phase (the entry's own is ticked, to be confirmed) and a valid-until that defaults to the previous entry's choice", () => {
    expect(screen.draft?.phase).toMatchObject({ required: true, items: [{ id: "problem", checked: true }, { id: "in_progress", checked: false }] });
    expect(screen.draft?.valid.mode).toBe("at");
    expect(screen.draft?.validFixed).toBeUndefined();
    expect(screen.draft?.types).toBeNull();
    expect(screen.draft?.typesSummary).toBe("Elevator");
  });

  it("carries who it is for over from the alert, in words", () => {
    expect(screen.aside.sentence).toBe("Residents of 45 Thorncliffe Park Dr (floors 3, 4).");
    expect(screen.aside.carried).toContain("carried over from the alert");
  });

  it("is drawn with the entry's words in the textarea, the target in a hidden field and one action: Save draft", () => {
    const out = html(screen);
    expect(out).toContain('name="target" value="' + ACK + '"');
    expect(out).toContain('name="from" value="correct"');
    expect(out).toContain('name="entry" value="' + NEW_ENTRY + '"');
    expect(out).toContain(">The elevator is out.</textarea>");
    expect(out).toContain('data-testid="replaces-text"');
    expect(out).toContain('data-testid="save-draft"');
    expect(out).toContain('name="valid-mode"');
    expect(out).not.toContain('data-testid="submit-button"');
  });
});

describe("withdrawing the chosen entry (O-15)", () => {
  const screen = start("withdraw", ENTRIES[1]);

  it("asks for the reason from the catalog, none chosen, and the words for residents", () => {
    expect(screen).toMatchObject({ mode: "withdraw", from: "withdraw", title: "Withdraw an alert" });
    expect(screen.draft?.reasons?.items.map((item) => [item.id, item.label, item.checked])).toEqual([
      ["wrong_place", "Wrong place", false],
      ["wrong_information", "Wrong information", false],
      ["duplicate", "Duplicate of another alert", false],
      ["other", "Other (write the reason)", false],
    ]);
    expect(screen.draft?.text).toMatchObject({ label: "Words for residents (needed for \"Other\")", value: "" });
    expect(screen.draft?.phase).toBeNull();
    expect(screen.draft?.validFixed).toBe(true);
  });

  it("is drawn with a required choice of reason, no valid-until and no phase, beside the entry that is withdrawn", () => {
    const out = html(screen);
    expect(out.match(/name="reason"/g)).toHaveLength(4);
    expect(out.match(/<input type="radio" required="" name="reason"/g)).toHaveLength(4);
    expect(out).not.toContain('name="valid-mode"');
    expect(out).not.toContain('name="phase"');
    expect(out).toContain('data-testid="replaces-text"');
    expect(out).toContain('name="target" value="' + ACK + '"');
    // The words are optional unless the reason is "other" (the server asks for them then).
    expect(out).not.toMatch(/<textarea[^>]*required/);
  });
});

describe("the composer of the draft a correction or a withdrawal made", () => {
  it("is a correction's composer: its words, phase and valid-until, the entry it corrects shown above, and who it is for changeable", () => {
    const screen = saved("correct", stateOf("correction"));
    expect(screen).toMatchObject({ mode: "correct", from: "correct", status: "draft", title: "Correct an alert" });
    expect(screen.draft?.text.label).toBe("2. The corrected wording");
    expect(screen.draft?.phase?.required).toBe(true);
    expect(screen.replaces).toMatchObject({ text: "The elevator is out." });
    const out = html(screen);
    expect(out).toContain('data-testid="replaces"');
    expect(out).toContain("Change who it is for");
    expect(out).toContain('data-testid="submit-button"');
    expect(screen.here).toBe(`/staff/alerts/correct?alert=${ALERT}&entry=${DRAFT}`);
  });

  it("is a withdrawal's composer: only the notice's words can change, nothing asks for a phase or a valid-until, and who it is for cannot be changed", () => {
    const screen = saved("withdraw", stateOf("withdrawal"));
    expect(screen).toMatchObject({ mode: "withdraw", from: "withdraw", status: "draft", title: "Withdraw an alert" });
    expect(screen.draft?.text.label).toBe("What residents read in the place of the entry");
    expect(screen.draft?.phase).toBeNull();
    expect(screen.draft?.validFixed).toBe(true);
    expect(screen.aside.carried).toContain("everyone who got that entry also gets this withdrawal");
    const out = html(screen);
    expect(out).not.toContain('name="valid-mode"');
    expect(out).not.toContain('name="phase"');
    expect(out).not.toContain("Change who it is for");
    expect(out).toContain('data-testid="submit-button"');
  });

  it("shows the submitted entry as waiting for a second person, like every entry", () => {
    const screen = saved("withdraw", stateOf("withdrawal", { status: "pending_approval", version: 1, contentHash: "a".repeat(64), submittedAt: NOW }));
    expect(screen.status).toBe("pending");
    expect(screen.pending?.pullBack.label).toBeTruthy();
    expect(html(screen)).toContain('data-testid="pending-panel"');
  });
});
