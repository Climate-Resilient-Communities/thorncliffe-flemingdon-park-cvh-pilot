// The Hub home's list of running alerts (S05.01): each open thread residents are reading, with the one way to add to it: "Add an update" (O-14), or
// "Promote to full alert" (O-13) while it is still only an acknowledgement. A closed thread is not in it, so none offers either.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Incidents, RunningThread } from "@/modules/alerting";
import { ALERT, OTHER_ALERT } from "../../../../../test/helpers/approvalReview";
import { IncidentsList } from "./IncidentsList";
import { incidentsView } from "./view";

const none: Incidents = { waiting: [], mine: [] };
const thread = (over: Partial<RunningThread> = {}): RunningThread => ({
  alertId: ALERT,
  slug: "abcd2345",
  isDrill: false,
  reportedAt: new Date("2026-10-04T13:30:00.000Z"),
  types: ["elevator", "power"],
  phase: "in_progress",
  validUntil: new Date("2026-10-05T14:00:00.000Z"),
  publishedAt: new Date("2026-10-04T15:00:00.000Z"),
  coveringKind: "update",
  ackOnly: false,
  entries: 3,
  ...over,
});

describe("what is running, on the Hub home", () => {
  it('offers "Add an update" on a thread that has an update or a full alert, with where things stand, until when and when residents last read something new', () => {
    const view = incidentsView(none, "coordinator", undefined, [thread()]);
    expect(view.running?.items).toEqual([
      {
        key: `running-${ALERT}`,
        title: "Elevator, Power",
        state: expect.stringMatching(/^Update, Work is under way\. Valid until .*10:00 a\.m\. EDT$/),
        since: expect.stringMatching(/^Last published .*11:00 a\.m\. EDT$/),
        note: null,
        drill: false,
        link: { href: `/staff/alerts/update?alert=${ALERT}`, label: "Add an update" },
      },
    ]);
  });

  it('offers "Promote to full alert" on a thread that is still only an acknowledgement', () => {
    const view = incidentsView(none, "admin", undefined, [thread({ ackOnly: true, coveringKind: "ack", phase: "problem", entries: 1 })]);
    expect(view.running?.items[0]).toMatchObject({ state: expect.stringMatching(/^Acknowledgement, There is a problem\./), link: { href: `/staff/alerts/promote?alert=${ALERT}`, label: "Promote to full alert" } });
  });

  it("lists drills in the section of their own, tagged, and never among the real alerts", () => {
    const view = incidentsView(none, "coordinator", undefined, [thread({ alertId: OTHER_ALERT, isDrill: true }), thread()]);
    expect(view.running?.items.map((item) => item.drill)).toEqual([false]);
    expect(view.drills?.items.map((item) => [item.key, item.drill, item.link.label])).toEqual([[`running-${OTHER_ALERT}`, true, "Add an update"]]);
  });

  it("has no running section for a role that does not write alerts, not an empty one, and gives such a role no link even if it were handed threads", () => {
    for (const role of ["director", "ambassador"] as const) {
      const view = incidentsView(none, role, undefined, [thread()]);
      expect(view.running).toBeNull();
      expect(view.drills).toBeNull();
    }
  });

  it("says no alert is running when none is, for a role that writes them", () => {
    expect(incidentsView(none, "coordinator").running).toMatchObject({ title: "Running alerts", none: "No alert is running.", items: [] });
  });

  it("opens a follow-up update in its own composer from Your alerts, and a first entry in the one it was written on", () => {
    const mine = (over: Record<string, unknown>) => ({ alertId: ALERT, entryId: "01900000-0000-7000-8000-00000000e179", kind: "update" as const, status: "draft" as const, types: ["elevator"], isDrill: false, version: 0, submittedAt: null, returnedNote: null, ...over });
    const view = incidentsView({ waiting: [], mine: [mine({ followUp: true }), mine({ followUp: false, entryId: "01900000-0000-7000-8000-00000000e17a" })] }, "coordinator");
    expect(view.mine.items.map((item) => item.link.href)).toEqual([
      `/staff/alerts/update?alert=${ALERT}&entry=01900000-0000-7000-8000-00000000e179`,
      `/staff/alerts/compose?alert=${ALERT}&entry=01900000-0000-7000-8000-00000000e17a`,
    ]);
  });
});

describe("the list of running alerts as it is drawn", () => {
  const html = (running: RunningThread[], role: "coordinator" | "director" = "coordinator") => renderToStaticMarkup(<IncidentsList view={incidentsView(none, role, undefined, running)} />);

  it("draws each running alert with its words and its one link, after what waits for approval and before the person's own", () => {
    const out = html([thread()]);
    expect(out).toContain('data-testid="incidents-running"');
    expect(out).toContain('data-testid="running-item"');
    expect(out).toMatch(/<a class="tap hub-link" href="\/staff\/alerts\/update\?alert=[^"]*">Add an update<\/a>/);
    expect(out.indexOf('data-testid="incidents-waiting"')).toBeLessThan(out.indexOf('data-testid="incidents-running"'));
    expect(out.indexOf('data-testid="incidents-running"')).toBeLessThan(out.indexOf('data-testid="incidents-mine"'));
  });

  it("says nothing is running when nothing is, and draws no list at all for a role that does not write alerts", () => {
    expect(html([])).toContain("No alert is running.");
    expect(html([thread()], "director")).not.toContain('data-testid="incidents-running"');
    expect(html([thread()], "director")).not.toContain("Add an update");
  });
});
