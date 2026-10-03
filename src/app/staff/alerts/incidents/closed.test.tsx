// The Hub home's list of what closed lately (S05.03): a closed alert is no longer among the running ones, and is listed as recently closed with how it closed, when, and the
// words it ended with, offering nothing to do (nothing can be added to a closed alert). A Director reads it as they read the rest; an Ambassador's home has none.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ClosedThread, Incidents, RunningThread } from "@/modules/alerting";
import { ALERT, OTHER_ALERT } from "../../../../../test/helpers/approvalReview";
import { IncidentsList } from "./IncidentsList";
import { CLOSED_DAYS, incidentsView } from "./view";

const none: Incidents = { waiting: [], mine: [] };
const closed = (over: Partial<ClosedThread> = {}): ClosedThread => ({
  alertId: ALERT,
  slug: "abcd2345",
  isDrill: false,
  types: ["elevator", "power"],
  reason: "resolved",
  closedAt: new Date("2026-10-04T15:30:00.000Z"),
  closingText: "Power is back on all floors.",
  ...over,
});
const running = (over: Partial<RunningThread> = {}): RunningThread => ({
  alertId: OTHER_ALERT,
  slug: "efgh6789",
  isDrill: false,
  reportedAt: new Date("2026-10-04T13:30:00.000Z"),
  types: ["water"],
  phase: "problem",
  validUntil: new Date("2026-10-05T14:00:00.000Z"),
  publishedAt: new Date("2026-10-04T15:00:00.000Z"),
  coveringKind: "ack",
  ackOnly: true,
  entries: 1,
  ...over,
});

describe("what closed lately, on the Hub home", () => {
  it("is listed with how it closed and when, and the words it ended with, and offers nothing to do", () => {
    const view = incidentsView(none, "coordinator", undefined, [], undefined, [closed()]);
    expect(view.closed).toMatchObject({ title: "Recently closed" });
    expect(view.closed?.items).toEqual([
      {
        key: `closed-${ALERT}`,
        title: "Elevator, Power",
        state: expect.stringMatching(/^Resolved Sunday, October 4, 2026 at 11:30 a\.m\. EDT$/),
        since: null,
        waited: null,
        note: null,
        drill: false,
        link: null,
        detail: "Final entry: Power is back on all floors.",
      },
    ]);
  });

  it("names each way a thread closes in its own words: resolved, expired and withdrawn", () => {
    const view = incidentsView(none, "admin", undefined, [], undefined, [closed({ reason: "resolved" }), closed({ alertId: "a", reason: "expired", closingText: null }), closed({ alertId: "b", reason: "withdrawn" })]);
    expect(view.closed?.items.map((item) => item.state.split(" ")[0])).toEqual(["Resolved", "Expired", "Withdrawn"]);
    // An entry with no closing words adds no detail line.
    expect(view.closed?.items[1].detail).toBeUndefined();
  });

  it("lists the most recently closed first, and keeps a drill in the drills' section, tagged apart from the real alerts", () => {
    const view = incidentsView(none, "coordinator", undefined, [], undefined, [
      closed({ alertId: "old", closedAt: new Date("2026-10-03T10:00:00.000Z") }),
      closed({ alertId: "drill", isDrill: true }),
      closed({ alertId: "new", closedAt: new Date("2026-10-04T16:00:00.000Z") }),
    ]);
    expect(view.closed?.items.map((item) => item.key)).toEqual(["closed-new", "closed-old"]);
    expect(view.drills.items.map((item) => [item.key, item.drill])).toEqual([["closed-drill", true]]);
  });

  it("is not among the running alerts: a closed thread offers no update, correction, withdrawal or resolution", () => {
    const view = incidentsView(none, "coordinator", undefined, [running()], undefined, [closed()]);
    expect(view.running?.items.map((item) => item.key)).toEqual([`running-${OTHER_ALERT}`]);
    const out = renderToStaticMarkup(<IncidentsList view={view} />);
    const closedSection = out.slice(out.indexOf('data-testid="incidents-closed"'));
    expect(closedSection).not.toContain("/staff/alerts/update");
    expect(closedSection).not.toContain("/staff/alerts/resolve");
    expect(closedSection).not.toContain("hub-link");
  });

  it("is no section when nothing closed lately, and is drawn between the running alerts and the person's own when something did", () => {
    const empty = incidentsView(none, "coordinator", undefined, [running()]);
    expect(empty.closed).toBeNull();
    expect(renderToStaticMarkup(<IncidentsList view={empty} />)).not.toContain('data-testid="incidents-closed"');
    // A drill that closed is in the drills' section, so it makes no section among the real alerts.
    expect(incidentsView(none, "coordinator", undefined, [], undefined, [closed({ isDrill: true })]).closed).toBeNull();
    const out = renderToStaticMarkup(<IncidentsList view={incidentsView(none, "coordinator", undefined, [running()], undefined, [closed()])} />);
    expect(out).toContain('data-testid="closed-final">Final entry: Power is back on all floors.</p>');
    expect(out.indexOf('data-testid="incidents-running"')).toBeLessThan(out.indexOf('data-testid="incidents-closed"'));
    expect(out.indexOf('data-testid="incidents-closed"')).toBeLessThan(out.indexOf('data-testid="incidents-mine"'));
    expect(CLOSED_DAYS).toBe(7);
    expect(out).toContain("last 7 days");
  });

  it("is read-only for a Director (no link at all) and absent for an Ambassador, whose home is their own alerts", () => {
    const director = renderToStaticMarkup(<IncidentsList view={incidentsView(none, "director", undefined, [], undefined, [closed()])} />);
    expect(director).toContain('data-testid="incidents-closed"');
    expect(incidentsView(none, "ambassador", undefined, [], undefined, [closed()]).closed).toBeNull();
  });
});
