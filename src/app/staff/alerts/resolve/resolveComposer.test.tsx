// "Mark resolved" (O-16, S05.03): the view model and how it is drawn. The final message is written on the composer every entry uses: the thread's audience, types and
// languages carried over, only the words the author's (no phase to choose, no valid-until to enter: it is "until resolved" and renewed by each save and the submit), the running
// alert above the form, what happens once it is approved (the alert closes, who gets it, what stops), and a closed thread that offers no form.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Audience } from "@/contracts/audience";
import { updateStart, type EntryState, type ThreadEntrySummary, type ThreadSummary } from "@/modules/alerting";
import type { BuildingFloorPlan } from "@/modules/places";
import { ComposerBody, type ComposerActions } from "../composer/ComposerBody";
import { composerScreen, startScreen, type ComposerScreen } from "../composer/view";
import { composerHref, composerOf, resolveHref } from "../pages";

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

function summaryOf(entries: ThreadEntrySummary[]): ThreadSummary {
  const sorted = [...entries].sort((a, b) => b.webPublishedAt.getTime() - a.webPublishedAt.getTime());
  const covering = sorted.find((entry) => entry.status !== "superseded") ?? null;
  return {
    thread: { id: ALERT, slug: "abcd2345", isDrill: false, reportedAt: new Date("2026-10-04T13:30:00.000Z"), status: "open" },
    entries: sorted,
    covering,
    validUntil: covering?.validUntil ?? null,
    ackOnly: sorted.length > 0 && sorted.every((entry) => entry.kind === "ack"),
  };
}

const RUNNING = summaryOf([published(ACK, "ack", 5), published(FIRST, "update", 40, { phase: "in_progress", text: "Power is back on floors 1 to 4.", validUntilMode: "resolved" })]);

function stateOf(entry: Record<string, unknown> = {}, over: Partial<EntryState> = {}): EntryState {
  return {
    thread: { id: ALERT, slug: "abcd2345", isDrill: false, reportedAt: new Date("2026-10-04T13:30:00.000Z"), status: "open" },
    entry: {
      id: DRAFT,
      alertId: ALERT,
      kind: "final",
      status: "draft",
      authorId: "01900000-0000-7000-8000-0000000000c1",
      editorIds: [],
      content: { text: "The elevator is back in service.", types: ["elevator"], audience: AUDIENCE, phase: "in_progress", validUntil: new Date("2026-10-05T16:00:00.000Z"), validUntilMode: "resolved" },
      version: 0,
      contentHash: null,
      submittedAt: null,
      returnedFor: null,
      returnedNote: null,
      approvedBy: null,
      approvedAt: null,
      webPublishedAt: null,
      possibleDuplicateOf: null,
      supersedesId: null,
      withdrawalReason: null,
      ...entry,
    } as EntryState["entry"],
    attempt: null,
    translations: [],
    priorKinds: ["ack", "update"],
    ...over,
  };
}

const start = (thread: ThreadSummary = RUNNING) => startScreen({ mode: "resolve", alertId: ALERT, entryId: NEW_ENTRY, thread, start: updateStart(thread.covering!, NOW), plans: PLANS });
const saved = (state: EntryState = stateOf(), thread: ThreadSummary | null = RUNNING) =>
  composerScreen({ mode: "resolve", state, plans: PLANS, preview: { sms: { body: "Hub: The elevator is back in service.", encoding: "gsm7", segments: 1 }, nineOneOneFirst: false }, saved: false, now: NOW, thread });

const noop = async () => ({ status: "idle" as const });
const actions: ComposerActions = { save: noop, pullBack: noop, start: noop };
const html = (screen: ComposerScreen) => renderToStaticMarkup(<ComposerBody screen={screen} actions={actions} />);

describe("the pages of Mark resolved", () => {
  it("has its own page, which a final is written on whatever came before it, and a link that opens its start for an alert", () => {
    expect(composerOf("final")).toBe("resolve");
    expect(composerOf("final", ["ack", "update"])).toBe("resolve");
    expect(resolveHref(ALERT)).toBe(`/staff/alerts/resolve?alert=${ALERT}`);
    expect(composerHref("resolve", { alertId: ALERT, entryId: DRAFT })).toBe(`/staff/alerts/resolve?alert=${ALERT}&entry=${DRAFT}`);
  });
});

describe("the start of a final message (O-16)", () => {
  const screen = start();

  it("is a composer of its own with the prototype's words, that has not made a draft yet: saving makes it", () => {
    expect(screen).toMatchObject({ mode: "resolve", from: "resolve", status: "new", title: "Mark resolved", ref: { alertId: ALERT, entryId: NEW_ENTRY }, here: `/staff/alerts/resolve?alert=${ALERT}` });
    expect(screen.lead).toContain("Resolving closes the alert with a final word");
    expect(screen.startNote).toContain("Approving it closes the alert");
    expect(screen.draft?.text.label).toBe("Final entry");
    expect(screen.draft?.text.hint).toContain("what is fixed, and what to do if it is not fixed for you");
    expect(screen.draft?.text.value).toBe("");
    expect(screen.pending).toBeUndefined();
    expect(screen.preview).toBeNull();
  });

  it("asks only for the words: no phase to choose, no valid-until to enter, and the thread's types and audience carried over in words", () => {
    expect(screen.draft?.phase).toBeNull();
    expect(screen.draft?.validFixed).toBe(true);
    expect(screen.draft?.types).toBeNull();
    expect(screen.draft?.typesSummary).toBe("Elevator");
    expect(screen.aside.sentence).toBe("Residents of 45 Thorncliffe Park Dr (floors 3, 4).");
    expect(screen.aside.groupsLink).toEqual({ href: "", label: "" });
  });

  it("shows the running alert above the form, with a lead that says the final entry is added at the top and closes the alert", () => {
    expect(screen.thread?.lead).toBe("What residents read now, newest first. Your final entry is added at the top and closes the alert: nothing here is deleted.");
    expect(screen.thread?.entries).toHaveLength(2);
  });

  it("says what happens when the alert is resolved: it moves to alerts that have ended, everyone who got any entry gets the final one on the channels they got it on, and nothing else is sent", () => {
    expect(screen.after?.title).toBe("What happens when you resolve");
    expect(screen.after?.items).toEqual([
      expect.stringContaining("moves to alerts that have ended"),
      "Everyone who got any entry of this alert gets the final entry by text, on the channels they got it on.",
      expect.stringContaining("texts still waiting for the other entries are cancelled"),
    ]);
  });
});

describe("a final message that was saved", () => {
  it("is the final's composer: its words, no phase, no valid-until, the running alert above it and the audience links leading back to it", () => {
    const screen = saved();
    expect(screen).toMatchObject({ mode: "resolve", from: "resolve", status: "draft", title: "Mark resolved", here: `/staff/alerts/resolve?alert=${ALERT}&entry=${DRAFT}` });
    expect(screen.draft?.phase).toBeNull();
    expect(screen.draft?.validFixed).toBe(true);
    expect(screen.draft?.text).toMatchObject({ label: "Final entry", value: "The elevator is back in service." });
    expect(screen.thread?.entries).toHaveLength(2);
    expect(screen.after?.items).toHaveLength(3);
    expect(screen.aside.link.href).toBe(`/staff/alerts/audience?alert=${ALERT}&entry=${DRAFT}&from=resolve`);
    expect(screen.aside.groupsLink.href).toBe(`/staff/alerts/audience/groups?alert=${ALERT}&entry=${DRAFT}&from=resolve`);
    expect(screen.preview?.lines).toEqual(["Hub: The elevator is back in service."]);
  });

  it("says nothing about a change while the final keeps the audience the thread has, and 'Now also for' when it widens it", () => {
    expect(saved().aside.change).toEqual({ alsoFor: null, noLongerFor: null, same: "Who it is for is the same as the alert now." });
    const wider = saved(stateOf({ content: { ...stateOf().entry.content, audience: audience([["7001", [floorId(3), floorId(4)]], ["7002", null]], ["seniors"]) } }));
    expect(wider.aside.change).toEqual({ alsoFor: "Now also for: 10 Gateway Blvd (all floors)", noLongerFor: null, same: null });
  });

  it("has the pending and locked states of every composer, and a thread that closed locks it: no form, only the note", () => {
    const pending = saved(stateOf({ status: "pending_approval", version: 1, contentHash: "e".repeat(64) }));
    expect(pending.status).toBe("pending");
    expect(pending.pending?.pullBack.label).toBe("Pull back to edit");
    const closed = saved(stateOf({}, { thread: { id: ALERT, slug: "abcd2345", isDrill: false, reportedAt: new Date("2026-10-04T13:30:00.000Z"), status: "closed" } }));
    expect(closed.status).toBe("locked");
    expect(closed.draft).toBeUndefined();
    expect(closed.locked).toBe("This alert is closed.");
  });
});

describe("the final message's composer as it is drawn", () => {
  const out = html(start());

  it("has a form with the final entry's text, the draft's ids and the page it is, and no phase and no valid-until fields", () => {
    expect(out).toContain("<h1>Mark resolved</h1>");
    expect(out).toContain(`<input type="hidden" name="alert" value="${ALERT}"/>`);
    expect(out).toContain(`<input type="hidden" name="entry" value="${NEW_ENTRY}"/>`);
    expect(out).toContain('<input type="hidden" name="from" value="resolve"/>');
    expect(out).toMatch(/<textarea[^>]*id="composer-text"[^>]*><\/textarea>/);
    expect(out).toContain("Final entry");
    expect(out).not.toContain('name="phase"');
    expect(out).not.toContain('name="valid-mode"');
    const region = out.slice(out.indexOf('class="layout-screen__actions"'));
    expect(region).toContain('data-testid="save-draft"');
    expect(region).not.toContain('data-testid="submit-button"');
  });

  it("shows what happens on resolving before the form, and the running alert above it", () => {
    expect(out).toContain('data-testid="after-resolve"');
    expect(out.indexOf('data-testid="thread-digest"')).toBeLessThan(out.indexOf('id="composer-form"'));
    expect(out.indexOf('data-testid="after-resolve"')).toBeLessThan(out.indexOf('id="composer-form"'));
  });

  it("draws a saved final with Save and Submit, and the audience links back to this composer", () => {
    const draft = html(saved());
    const region = draft.slice(draft.indexOf('class="layout-screen__actions"'));
    expect(region).toContain('data-testid="save-draft"');
    expect(region).toContain('data-testid="submit-button"');
    expect(draft).toContain(`href="/staff/alerts/audience?alert=${ALERT}&amp;entry=${DRAFT}&amp;from=resolve"`);
  });
});
