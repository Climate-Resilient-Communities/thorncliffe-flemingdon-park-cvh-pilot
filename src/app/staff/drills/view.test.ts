import { describe, expect, it } from "vitest";
import type { DrillThreadSummary } from "@/modules/alerting";
import type { DrillResultRow } from "@/modules/messaging";
import { drillView, drillsView, languageName, rosterSummary } from "./view";

const A = "01900000-0000-7000-8000-0000000000a1";
const B = "01900000-0000-7000-8000-0000000000a2";
const labels = new Map([
  [A, "Priya"],
  [B, "Hub phone"],
]);

const thread: DrillThreadSummary = {
  id: "01900000-0000-7000-8000-0000000000c1",
  reportedAt: new Date("2026-10-05T14:30:00.000Z"),
  status: "open",
  closedReason: null,
  types: ["power"],
  entries: [
    { id: "e1", kind: "ack", status: "approved", approvedAt: new Date("2026-10-05T14:40:00.000Z") },
    { id: "e2", kind: "correction", status: "pending_approval", approvedAt: null },
  ],
};

const row = (over: Partial<DrillResultRow>): DrillResultRow => ({ entryId: "e1", recipientId: A, lang: "en", waiting: 0, handedOff: 0, delivered: 0, undelivered: 0, failed: 0, unknown: 0, notSent: 0, ...over });

describe("a drill as the Drills page shows it", () => {
  it("says when it was reported (Toronto time), that it is running, and what was rehearsed with the state of each entry", () => {
    const view = drillView(thread, [], labels);
    expect(view.heading).toBe("Drill reported Monday, October 5, 2026 at 10:30 a.m. EDT");
    expect(view.status).toEqual({ id: "open", text: "Running" });
    expect(view.entries).toBe("Entries: Acknowledgement (approved), Correction (waiting for approval)");
    expect(drillView({ ...thread, status: "closed", entries: [] }, [], labels)).toMatchObject({ status: { id: "closed", text: "Ended" }, entries: "Entries: -" });
  });

  it("links to the approval of each entry waiting for one while the drill runs, so a second Admin can review it from here (UAT F-6)", () => {
    expect(drillView(thread, [], labels).review).toEqual([{ href: `/staff/alerts/approve?alert=${thread.id}&entry=e2`, label: "Review the drill correction" }]);
    expect(drillView({ ...thread, entries: [{ id: "e1", kind: "ack", status: "pending_approval", approvedAt: null }] }, [], labels).review).toEqual([
      { href: `/staff/alerts/approve?alert=${thread.id}&entry=e1`, label: "Review the drill acknowledgement" },
    ]);
    // Nothing to review once every entry is decided, or once the drill has ended.
    expect(drillView({ ...thread, entries: [thread.entries[0]] }, [], labels).review).toEqual([]);
    expect(drillView({ ...thread, status: "closed" }, [], labels).review).toEqual([]);
  });

  it("says no text was written for a drill with no results", () => {
    expect(drillView(thread, [], labels).results).toMatchObject({ none: "No text has been written for this drill yet.", rows: [], waiting: null, notSent: null, unknownNote: null });
  });

  it("shows, per roster member and language, how many texts were handed off, delivered, undelivered, failed and unknown, members by label", () => {
    const view = drillView(
      thread,
      [
        row({ recipientId: A, lang: "ur", handedOff: 3, delivered: 1, undelivered: 1, unknown: 1 }),
        row({ recipientId: B, lang: "en", handedOff: 2, delivered: 2 }),
        row({ recipientId: A, lang: "en", handedOff: 1, failed: 1 }),
      ],
      labels,
    );
    expect(view.results.none).toBeNull();
    expect(view.results.rows.map((r) => [r.member, r.language])).toEqual([
      ["Hub phone", "English"],
      ["Priya", "English"],
      ["Priya", "Urdu"],
    ]);
    expect(view.results.rows[2].counts.map((count) => count.text)).toEqual(["Handed off: 3", "Delivered: 1", "Undelivered: 1", "Failed: 0", "Unknown: 1"]);
    expect(view.results.rows[1].counts.map((count) => count.text)).toEqual(["Handed off: 1", "Delivered: 0", "Undelivered: 0", "Failed: 1", "Unknown: 0"]);
    expect(view.results.unknownNote).toBe("An unknown text may or may not have arrived. Find out what happened before launch.");
  });

  it("names a member removed from the roster as such, last, and notes what still waits and what never went", () => {
    const view = drillView(thread, [row({ recipientId: null, notSent: 2 }), row({ recipientId: A, waiting: 1, handedOff: 0 })], labels);
    expect(view.results.rows.map((r) => r.member)).toEqual(["Priya", "Removed from the roster"]);
    expect(view.results.waiting).toBe("Still waiting to be sent: 1.");
    expect(view.results.notSent).toBe("Never sent: 2.");
    expect(view.results.unknownNote).toBeNull();
  });

  it("keeps each entry's counts apart, entries oldest first, each row naming the kind of text", () => {
    const view = drillView(
      thread,
      [row({ entryId: "e2", recipientId: A, handedOff: 1, delivered: 1 }), row({ entryId: "e1", recipientId: B, handedOff: 1, unknown: 1 }), row({ entryId: "e1", recipientId: A, handedOff: 1, delivered: 1 })],
      labels,
    );
    expect(view.results.rows.map((r) => [r.entry, r.member])).toEqual([
      ["Acknowledgement", "Hub phone"],
      ["Acknowledgement", "Priya"],
      ["Correction", "Priya"],
    ]);
    expect(view.results.rows[0].counts.map((count) => count.text)).toContain("Unknown: 1");
    expect(view.results.rows[2].counts.map((count) => count.text)).toContain("Unknown: 0");
  });

  it("carries the exercise marker on each drill", () => {
    expect(drillView(thread, [], labels).exercise.title).toBe("Exercise. This is practice.");
  });

  it("holds no phone number anywhere", () => {
    const view = drillView(thread, [row({ handedOff: 1, delivered: 1 })], labels);
    expect(JSON.stringify(view)).not.toMatch(/\+1|\d{3}[-. ]\d{3}[-. ]\d{4}/);
  });
});

describe("the Drills page", () => {
  it("starts a drill from the start page, opens the roster, and says the drill counts are kept apart from real alerts", () => {
    const view = drillsView({ rosterSize: 3, drills: [] });
    expect(view.start).toMatchObject({ label: "Start a drill", href: "/staff/drills/start" });
    expect(view.roster).toMatchObject({ summary: "3 people are on the drill roster.", link: { label: "Open the drill roster", href: "/staff/drills/roster" } });
    expect(view.recent).toMatchObject({ none: "No drill has been run yet.", drills: [], apart: "Drill counts are kept apart from real alerts and never added to them." });
  });

  it("says the size of the roster in words, and what an empty one means", () => {
    expect(rosterSummary(0)).toBe("The drill roster is empty, so a drill reaches no one yet.");
    expect(rosterSummary(1)).toBe("1 person is on the drill roster.");
    expect(rosterSummary(12)).toBe("12 people are on the drill roster.");
  });

  it("names a language in English words", () => {
    expect(languageName("en")).toBe("English");
    expect(languageName("zh-Hant")).toBe("Chinese (Traditional)");
    expect(languageName("ps")).toBe("Pashto");
  });
});
