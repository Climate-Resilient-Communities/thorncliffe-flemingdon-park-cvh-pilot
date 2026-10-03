// The update composers (S05.01): "Add an update" (O-14) and "Promote to full alert" (O-13), the view model and how it is drawn: the thread's audience, types and
// languages carried over, a phase that is required and not carried over, a valid-until that defaults to the previous entry's choice ("until resolved"
// renews to 24 hours from now), the running alert above the form, what the update changes about who it is for, and a closed thread that offers no form.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Audience } from "@/contracts/audience";
import { updateStart, type EntryState, type ThreadEntrySummary, type ThreadSummary } from "@/modules/alerting";
import type { BuildingFloorPlan } from "@/modules/places";
import { ComposerBody, type ComposerActions } from "../composer/ComposerBody";
import { MESSAGE_CODES, catalogText, closedUpdate, composerScreen, missingComposer, startScreen, unpublishedUpdate, type ComposerScreen } from "../composer/view";

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ACK = "01900000-0000-7000-8000-00000000e100";
const FIRST = "01900000-0000-7000-8000-00000000e101";
const DRAFT = "01900000-0000-7000-8000-00000000e177";
const NEW_ENTRY = "01900000-0000-7000-8000-00000000e999";
const NOW = new Date("2026-10-04T16:00:00.000Z");
const floorId = (index: number) => `01900000-0000-7000-8000-00007001${String(index).padStart(4, "0")}`;

const PLANS: BuildingFloorPlan[] = [
  { rsn: "7001", address: "45 Thorncliffe Park Dr", neighbourhoodId: "TP", neighbourhoodName: "Thorncliffe Park", floors: ["G", "1", "2", "3", "4"].map((label, index) => ({ id: floorId(index), label, sortOrder: index })) },
  { rsn: "7002", address: "10 Gateway Blvd", neighbourhoodId: "FP", neighbourhoodName: "Flemingdon Park", floors: [] },
];

const audience = (rsns: [string, string[] | null][], groups: string[] = [], types = ["elevator"]): Audience => ({
  scope: "buildings",
  buildings: rsns.map(([rsn, floors]) => ({ rsn, floors })),
  groups: groups as Audience["groups"],
  types,
});
const AUDIENCE = audience([["7001", [floorId(3), floorId(4)]]], ["seniors"]);

/** An entry residents read, published `minutes` after 14:00 on 4 October 2026. */
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

function summaryOf(entries: ThreadEntrySummary[], over: Partial<ThreadSummary> = {}): ThreadSummary {
  const sorted = [...entries].sort((a, b) => b.webPublishedAt.getTime() - a.webPublishedAt.getTime());
  const covering = sorted.find((entry) => entry.status !== "superseded") ?? null;
  return {
    thread: { id: ALERT, slug: "abcd2345", isDrill: false, reportedAt: new Date("2026-10-04T13:30:00.000Z"), status: "open" },
    entries: sorted,
    covering,
    validUntil: covering?.validUntil ?? null,
    ackOnly: sorted.length > 0 && sorted.every((entry) => entry.kind === "ack"),
    ...over,
  };
}

const ACK_ONLY = summaryOf([published(ACK, "ack", 5, { validUntilMode: "resolved", validUntil: new Date("2026-10-05T14:05:00.000Z") })]);
const RUNNING = summaryOf([published(ACK, "ack", 5), published(FIRST, "update", 40, { phase: "in_progress", text: "Power is back on floors 1 to 4.", validUntil: new Date("2026-10-05T20:00:00.000Z") })]);

function stateOf(entry: Record<string, unknown> = {}, over: Partial<EntryState> = {}): EntryState {
  return {
    thread: { id: ALERT, slug: "abcd2345", isDrill: false, reportedAt: new Date("2026-10-04T13:30:00.000Z"), status: "open" },
    entry: {
      id: DRAFT,
      alertId: ALERT,
      kind: "update",
      status: "draft",
      authorId: "01900000-0000-7000-8000-0000000000c1",
      editorIds: [],
      content: { text: "We know more now.", types: ["elevator"], audience: AUDIENCE, phase: "in_progress", validUntil: new Date("2026-10-05T16:00:00.000Z"), validUntilMode: "resolved" },
      version: 0,
      contentHash: null,
      submittedAt: null,
      returnedFor: null,
      returnedNote: null,
      approvedBy: null,
      approvedAt: null,
      webPublishedAt: null,
      possibleDuplicateOf: null,
      ...entry,
    } as EntryState["entry"],
    attempt: null,
    translations: [],
    priorKinds: ["ack"],
    ...over,
  };
}

const start = (mode: "update" | "promote", thread: ThreadSummary = RUNNING) => startScreen({ mode, alertId: ALERT, entryId: NEW_ENTRY, thread, start: updateStart(thread.covering!, NOW), plans: PLANS });
const saved = (mode: "update" | "promote", state: EntryState = stateOf(), thread: ThreadSummary | null = RUNNING) =>
  composerScreen({ mode, state, plans: PLANS, preview: { sms: { body: "Hub: We know more now.", encoding: "gsm7", segments: 1 }, nineOneOneFirst: false }, saved: false, now: NOW, thread });

const noop = async () => ({ status: "idle" as const });
const actions: ComposerActions = { save: noop, pullBack: noop, start: noop };
const html = (screen: ComposerScreen) => renderToStaticMarkup(<ComposerBody screen={screen} actions={actions} />);

describe("starting an update to a running alert (O-14)", () => {
  const screen = start("update");

  it("is a composer of its own, with its words, that has not made a draft yet: saving makes it", () => {
    expect(screen).toMatchObject({ mode: "update", from: "update", status: "new", title: "Add an update", ref: { alertId: ALERT, entryId: NEW_ENTRY } });
    expect(screen.lead).toContain("above the earlier entries");
    expect(screen.startNote).toBe("Saving makes the draft. Then you can change who it is for, read the text message and submit it for approval.");
    expect(screen.here).toBe(`/staff/alerts/update?alert=${ALERT}`);
    expect(screen.pending).toBeUndefined();
    expect(screen.locked).toBeUndefined();
    expect(screen.preview).toBeNull();
    expect(screen.resume).toBeNull();
    expect(screen.benchmark).toBe("");
  });

  it("carries the thread's types over as words, not as choices, and its audience over in words with nothing to link to yet", () => {
    expect(screen.draft?.types).toBeNull();
    expect(screen.draft?.typesSummary).toBe("Elevator");
    expect(screen.aside.sentence).toBe("Residents of 45 Thorncliffe Park Dr (floors 3, 4).");
    expect(screen.aside.groups).toContain("Seniors");
    expect(screen.aside.carried).toContain("carried over from the alert");
    expect(screen.aside.groupsLink).toEqual({ href: "", label: "" });
    expect(screen.aside.change).toEqual({ alsoFor: null, noLongerFor: null, same: null });
  });

  it("lists all fifteen languages as translated when the update is submitted", () => {
    expect(screen.languages.rows).toHaveLength(15);
    expect(screen.languages.rows.every((row) => row.state === "waiting")).toBe(true);
  });

  it("needs the phase: none of the two is ticked, the choice is required and says so, and nothing about the alert's own phase is carried over", () => {
    expect(screen.draft?.phase?.required).toBe(true);
    expect(screen.draft?.phase?.hint).toBe("Required: choose where things stand now.");
    expect(screen.draft?.phase?.items.map((item) => [item.id, item.checked])).toEqual([
      ["problem", false],
      ["in_progress", false],
    ]);
    // The thread's latest entry is in progress, and still nothing is ticked.
    expect(RUNNING.covering?.phase).toBe("in_progress");
  });

  it("starts with no text: the author writes what is known now", () => {
    expect(screen.draft?.text).toMatchObject({ value: "", max: 600 });
  });

  it('defaults the valid-until to the covering entry\'s choice: "until resolved" is kept and its time is 24 elapsed hours from now', () => {
    const resolved = start("promote", ACK_ONLY);
    expect(resolved.draft?.valid.mode).toBe("resolved");
    // 24 hours after 4 October 16:00 UTC (12:00 in Toronto) is 5 October 12:00 in Toronto.
    expect(resolved.draft?.valid.fields).toEqual({ date: "2026-10-05", time: "12:00", fold: "" });
  });

  it("keeps a date and a time as the covering entry chose it, in Toronto time, even when it has passed", () => {
    const at = start("update", summaryOf([published(FIRST, "update", 40, { validUntilMode: "at", validUntil: new Date("2026-10-05T20:00:00.000Z") })]));
    expect(at.draft?.valid.mode).toBe("at");
    expect(at.draft?.valid.fields).toEqual({ date: "2026-10-05", time: "16:00", fold: "" });
    const passed = start("update", summaryOf([published(FIRST, "update", 40, { validUntilMode: "at", validUntil: new Date("2026-10-04T10:00:00.000Z") })]));
    expect(passed.draft?.valid.fields).toEqual({ date: "2026-10-04", time: "06:00", fold: "" });
  });

  it("shows the running alert above the form: the entries newest first, each with its time and where things stood, and the valid-until the thread has", () => {
    expect(screen.thread?.title).toBe("The running alert");
    expect(screen.thread?.entries.map((entry) => [entry.heading, entry.phase, entry.text])).toEqual([
      [expect.stringMatching(/^Update, .*10:40/), "Work is under way", "Power is back on floors 1 to 4."],
      [expect.stringMatching(/^Acknowledgement, .*10:05/), "There is a problem", "ack at 5"],
    ]);
    expect(screen.thread?.validUntil).toMatch(/^Valid until .*4:00 p\.m\. EDT \(Toronto time\)$/);
  });

  it('is "Promote to full alert" for the first update to an acknowledgement, with its own words and page', () => {
    const promote = start("promote", ACK_ONLY);
    expect(promote).toMatchObject({ mode: "promote", from: "promote", title: "Promote to full alert", here: `/staff/alerts/promote?alert=${ALERT}` });
    expect(promote.lead).toContain("first update to the acknowledgement");
  });
});

describe("an update draft that was saved", () => {
  it("is the composer of an update: the thread's types as words, a required phase with the author's choice ticked, and the running alert above it", () => {
    const screen = saved("update");
    expect(screen).toMatchObject({ mode: "update", from: "update", status: "draft", title: "Add an update", here: `/staff/alerts/update?alert=${ALERT}&entry=${DRAFT}` });
    expect(screen.draft?.types).toBeNull();
    expect(screen.draft?.typesSummary).toBe("Elevator");
    expect(screen.draft?.phase?.required).toBe(true);
    expect(screen.draft?.phase?.items.map((item) => [item.id, item.checked])).toEqual([
      ["problem", false],
      ["in_progress", true],
    ]);
    expect(screen.draft?.valid.mode).toBe("resolved");
    expect(screen.thread?.entries).toHaveLength(2);
    expect(screen.preview?.lines).toEqual(["Hub: We know more now."]);
  });

  it("is the promotion composer on its own page, with the audience pages leading back to it", () => {
    const screen = saved("promote", stateOf({}, { priorKinds: ["ack"] }), ACK_ONLY);
    expect(screen).toMatchObject({ mode: "promote", from: "promote", title: "Promote to full alert", here: `/staff/alerts/promote?alert=${ALERT}&entry=${DRAFT}` });
    expect(screen.aside.link.href).toBe(`/staff/alerts/audience?alert=${ALERT}&entry=${DRAFT}&from=promote`);
    expect(screen.aside.groupsLink.href).toBe(`/staff/alerts/audience/groups?alert=${ALERT}&entry=${DRAFT}&from=promote`);
  });

  it("says nothing about a change while the update keeps the audience the thread has, only that it is the same", () => {
    const screen = saved("update");
    expect(screen.aside.change).toEqual({ alsoFor: null, noLongerFor: null, same: "Who it is for is the same as the alert now." });
  });

  it('says "Now also for" when the update widens who it is for, and "No longer for" when it narrows it, against what the thread has now', () => {
    const wider = saved("update", stateOf({ content: { ...stateOf().entry.content, audience: audience([["7001", [floorId(3), floorId(4)]], ["7002", null]], ["seniors"]) } }));
    expect(wider.aside.change).toEqual({ alsoFor: "Now also for: 10 Gateway Blvd (all floors)", noLongerFor: null, same: null });
    const narrower = saved("update", stateOf({ content: { ...stateOf().entry.content, audience: audience([["7001", [floorId(3)]]], ["seniors"]) } }));
    expect(narrower.aside.change).toEqual({ alsoFor: null, noLongerFor: "No longer for: 45 Thorncliffe Park Dr (floors 4)", same: null });
  });

  it("has no change to show without the thread to compare with, and none against itself once it is the entry that covers the thread", () => {
    expect(saved("update", stateOf(), null).aside.change).toEqual({ alsoFor: null, noLongerFor: null, same: null });
    const covering = summaryOf([published(ACK, "ack", 5), published(DRAFT, "update", 50)]);
    expect(saved("update", stateOf({ status: "approved", approvedBy: "x", webPublishedAt: new Date() }), covering).aside.change).toEqual({ alsoFor: null, noLongerFor: null, same: null });
  });

  it("has the pending and locked states of every composer: Pull back to edit while it waits, the approved note after", () => {
    const pending = saved("update", stateOf({ status: "pending_approval", version: 1, contentHash: "e".repeat(64) }));
    expect(pending.status).toBe("pending");
    expect(pending.pending?.pullBack.label).toBe("Pull back to edit");
    expect(saved("update", stateOf({ status: "approved" })).locked).toBe("This alert was approved and is published.");
  });

  it("is not changed for the acknowledgement and alert composers: they have no thread, no carried-over note and no required hint", () => {
    const alert = composerScreen({ mode: "alert", state: stateOf({}, { priorKinds: [] }), plans: PLANS, preview: null, saved: false, now: NOW });
    expect(alert.thread).toBeUndefined();
    expect(alert.aside.carried).toBeUndefined();
    expect(alert.aside.change).toBeUndefined();
    expect(alert.from).toBe("compose");
    expect(alert.draft?.phase).toMatchObject({ required: true, hint: null });
    const ack = composerScreen({ mode: "ack", state: stateOf({ kind: "ack" }, { priorKinds: [] }), plans: PLANS, preview: null, saved: false, now: NOW });
    expect(ack.from).toBe("ack");
    expect(ack.draft?.phase).toBeNull();
  });
});

describe("a thread that cannot be added to", () => {
  it('says a closed thread is "already closed" and offers nothing: no form, no text, only the way back', () => {
    const closed = closedUpdate();
    expect(closed).toEqual({ kind: "closed", message: "This alert is already closed. Nothing more can be added to it.", back: { href: "/staff", label: "Back to the Hub" } });
  });

  it("says a thread with nothing published has nothing to add to, and that an unknown one is not found", () => {
    expect(unpublishedUpdate()).toMatchObject({ kind: "unpublished", message: expect.stringContaining("nothing to add an update to") });
    expect(missingComposer().kind).toBe("missing");
  });

  it("has words for every refusal an update can end with, each its own", () => {
    for (const code of ["ALERT_CLOSED", "NO_PUBLISHED_ENTRY", "ENTRY_ID_INVALID", "TYPES_CHANGED", "PHASE_INVALID"] as const) {
      expect(MESSAGE_CODES, code).toContain(code);
    }
    const words = (code: string) => catalogText(`errors.${code}`, { max: 600 });
    expect(words("ALERT_CLOSED")).toBe("This alert is already closed.");
    expect(new Set(["ALERT_CLOSED", "NO_PUBLISHED_ENTRY", "ENTRY_ID_INVALID", "TYPES_CHANGED", "PHASE_INVALID"].map(words)).size).toBe(5);
  });
});

describe("the update composer as it is drawn", () => {
  const out = html(start("update"));

  it("has a form with the text, a required phase with none ticked, the valid-until, the draft's ids and the page it is, and Save draft as its one action", () => {
    expect(out).toContain("<h1>Add an update</h1>");
    expect(out).toContain(`<input type="hidden" name="alert" value="${ALERT}"/>`);
    expect(out).toContain(`<input type="hidden" name="entry" value="${NEW_ENTRY}"/>`);
    expect(out).toContain('<input type="hidden" name="from" value="update"/>');
    expect(out).toMatch(/<textarea[^>]*id="composer-text"[^>]*><\/textarea>/);
    expect(out.match(/<input type="radio"[^>]*name="phase"/g)).toHaveLength(2);
    expect(out.match(/<input type="radio"[^>]*required=""[^>]*name="phase"/g)).toHaveLength(2);
    expect(out).not.toMatch(/<input type="radio"[^>]*name="phase"[^>]*checked=""/);
    expect(out).toContain('name="valid-mode"');
    const region = out.slice(out.indexOf('class="layout-screen__actions"'));
    expect(region).toContain('data-testid="save-draft"');
    expect(region).not.toContain('data-testid="submit-button"');
    expect(out.match(/<form /g)).toHaveLength(1);
  });

  it("shows the running alert above the form, newest entry first, and the carried-over audience and note in the aside, with no links to pages that have no draft to open on", () => {
    expect(out.indexOf('data-testid="thread-digest"')).toBeLessThan(out.indexOf('id="composer-form"'));
    const entries = out.match(/data-testid="thread-entry"/g);
    expect(entries).toHaveLength(2);
    expect(out.indexOf("Power is back on floors 1 to 4.")).toBeLessThan(out.indexOf("ack at 5"));
    expect(out).toContain('data-testid="thread-valid-until"');
    expect(out).toContain('data-testid="start-note"');
    expect(out).toContain('data-testid="audience-carried"');
    const aside = out.slice(out.indexOf('data-testid="composer-aside"'));
    expect(aside).not.toContain('href="/staff/alerts/audience');
  });

  it("is one column with the main content first and the aside after it, in the Hub's two-column grid", () => {
    expect(out).toContain('class="layout-grid" data-two-column="aside"');
    expect(out.indexOf('data-testid="languages"')).toBeLessThan(out.indexOf('data-testid="composer-aside"'));
  });

  it("draws a saved update with the phase ticked as chosen, the audience links back to this composer, the change as flagged notes, and Save and Submit", () => {
    const wider = html(saved("promote", stateOf({ content: { ...stateOf().entry.content, audience: audience([["7001", [floorId(3), floorId(4)]], ["7002", null]], ["seniors"]) } }), ACK_ONLY));
    expect(wider).toContain('<input type="hidden" name="from" value="promote"/>');
    expect(wider).toMatch(/<input type="radio"[^>]*name="phase"[^>]*checked=""[^>]*value="in_progress"/);
    expect(wider).toContain(`href="/staff/alerts/audience?alert=${ALERT}&amp;entry=${DRAFT}&amp;from=promote"`);
    expect(wider).toMatch(/<p role="note" class="hub-flag hub-wrap" data-testid="audience-also-for">Now also for: 10 Gateway Blvd \(all floors\)<\/p>/);
    expect(wider).not.toContain('data-testid="audience-no-longer-for"');
    const region = wider.slice(wider.indexOf('class="layout-screen__actions"'));
    expect(region).toContain('data-testid="save-draft"');
    expect(region).toContain('data-testid="submit-button"');
  });

  it("carries the page it is in the pull-back form of a submitted update, so pulling it back returns to the same composer", () => {
    const pending = html(saved("update", stateOf({ status: "pending_approval", version: 1, contentHash: "e".repeat(64) })));
    expect(pending).toContain('id="pull-back-form"');
    expect(pending.slice(pending.indexOf('id="pull-back-form"'))).toContain('<input type="hidden" name="from" value="update"/>');
  });
});
