import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DrillThreadSummary } from "@/modules/alerting";
import type { DrillResultRow } from "@/modules/messaging";
import { DrillsView } from "./DrillsView";
import { drillView, drillsView } from "./view";

const A = "01900000-0000-7000-8000-0000000000a1";
const thread: DrillThreadSummary = {
  id: "01900000-0000-7000-8000-0000000000c1",
  reportedAt: new Date("2026-10-05T14:30:00.000Z"),
  status: "open",
  closedReason: null,
  types: ["power"],
  entries: [{ id: "e1", kind: "ack", status: "approved", approvedAt: new Date("2026-10-05T14:40:00.000Z") }],
};
const rows: DrillResultRow[] = [
  { entryId: "e1", recipientId: A, lang: "ur", waiting: 0, handedOff: 2, delivered: 1, undelivered: 0, failed: 0, unknown: 1, notSent: 0 },
  { entryId: "e1", recipientId: null, lang: "en", waiting: 1, handedOff: 0, delivered: 0, undelivered: 0, failed: 0, unknown: 0, notSent: 1 },
];
const page = (drills: ReturnType<typeof drillView>[], size = 2) => renderToStaticMarkup(<DrillsView view={drillsView({ rosterSize: size, drills })} />);

describe("the Drills page with a drill", () => {
  const html = page([drillView(thread, rows, new Map([[A, "Priya"]]))]);

  it("starts a drill with the Hub's own button, in a form that opens the start page", () => {
    expect(html).toMatch(/<form[^>]*action="\/staff\/drills\/start"[^>]*method="get"/);
    expect(html).toMatch(/<button[^>]*class="hub-button hub-button--primary"[^>]*>Start a drill<\/button>/);
  });

  it("shows the exercise marker on the drill and the kind of text each count row is for", () => {
    expect(html).toContain('data-testid="exercise-marker"');
    expect(html).toContain('data-testid="drill-result-entry"');
  });

  it("says who a drill reaches and links to the roster", () => {
    expect(html).toContain("2 people are on the drill roster.");
    expect(html).toContain('href="/staff/drills/roster"');
  });

  it("shows the drill with its state, its entries and, per member and language, the five counts", () => {
    expect(html).toContain("Drill reported Monday, October 5, 2026 at 10:30 a.m. EDT");
    expect(html).toContain("Running");
    expect(html).toContain("Entries: Acknowledgement (approved)");
    expect(html).toContain("Priya");
    expect(html).toContain("Urdu");
    for (const text of ["Handed off: 2", "Delivered: 1", "Undelivered: 0", "Failed: 0", "Unknown: 1"]) expect(html).toContain(text);
    expect(html).toContain("Removed from the roster");
  });

  it("flags an unknown text for investigation, and says what waits and what never went", () => {
    expect(html).toContain("An unknown text may or may not have arrived. Find out what happened before launch.");
    expect(html).toContain("Still waiting to be sent: 1.");
    expect(html).toContain("Never sent: 1.");
  });

  it("says the drill counts are kept apart from real alerts", () => {
    expect(html).toContain("Drill counts are kept apart from real alerts and never added to them.");
  });

  it("holds no phone number", () => {
    expect(html).not.toMatch(/\+1\d|\d{3}[-. ]\d{3}[-. ]\d{4}/);
  });
});

describe("the Drills page with no drill", () => {
  it("says none has been run, and an empty roster says a drill reaches no one yet", () => {
    const html = page([], 0);
    expect(html).toContain('data-testid="drills-none"');
    expect(html).toContain("No drill has been run yet.");
    expect(html).toContain("The drill roster is empty, so a drill reaches no one yet.");
  });
});
