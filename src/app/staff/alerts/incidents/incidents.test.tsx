import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { IncidentRow, Incidents } from "@/modules/alerting";
import { ALERT, ENTRY, OTHER_ALERT, OTHER_ENTRY } from "../../../../../test/helpers/approvalReview";
import { IncidentsList } from "./IncidentsList";
import { incidentsView } from "./view";

const SUBMITTED = new Date("2026-10-04T14:00:00.000Z");
const row = (over: Partial<IncidentRow> = {}): IncidentRow => ({
  alertId: ALERT,
  entryId: ENTRY,
  kind: "ack",
  status: "pending_approval",
  types: ["elevator", "power"],
  isDrill: false,
  version: 1,
  submittedAt: SUBMITTED,
  returnedNote: null,
  ...over,
});
const none: Incidents = { waiting: [], mine: [] };

describe("what waits for a person (the Hub home)", () => {
  it("lists, for a Coordinator or an Admin, the entries waiting for their approval with when each was submitted and a link to review it", () => {
    const view = incidentsView({ waiting: [row()], mine: [] }, "coordinator");
    expect(view.waiting?.items).toEqual([
      {
        key: `waiting-${ENTRY}`,
        title: "Elevator, Power · Acknowledgement",
        state: "Waiting for a second person",
        since: expect.stringMatching(/^Submitted .*10:00/),
        note: null,
        drill: false,
        link: { href: `/staff/alerts/approve?alert=${ALERT}&entry=${ENTRY}`, label: "Review" },
      },
    ]);
    expect(incidentsView({ waiting: [row()], mine: [] }, "admin").waiting?.items).toHaveLength(1);
  });

  it("has no waiting section at all for a role that never approves, not an empty one", () => {
    for (const role of ["director", "ambassador"] as const) expect(incidentsView(none, role).waiting).toBeNull();
    expect(incidentsView(none, "coordinator").waiting?.none).toBe("Nothing is waiting for your approval.");
  });

  it("shows the author a draft an approver sent back with the approver's note, and a draft with none as a draft", () => {
    const view = incidentsView(
      {
        waiting: [],
        mine: [
          row({ status: "draft", submittedAt: null, version: 1, returnedNote: "Say which floors." }),
          row({ entryId: OTHER_ENTRY, alertId: OTHER_ALERT, status: "draft", submittedAt: null, version: 0 }),
          row({ entryId: "01900000-0000-7000-8000-00000000e179", alertId: OTHER_ALERT, kind: "update" }),
        ],
      },
      "coordinator",
    );
    expect(view.mine.items.map((item) => [item.state, item.note])).toEqual([
      ["Returned to you", "Note from the approver: Say which floors."],
      ["Draft", null],
      ["Waiting for a second person", null],
    ]);
    // A draft opens in its composer: the acknowledgement's for an acknowledgement, the alert's for an update.
    expect(view.mine.items.map((item) => item.link.href)).toEqual([
      `/staff/alerts/ack?alert=${ALERT}&entry=${ENTRY}`,
      `/staff/alerts/ack?alert=${OTHER_ALERT}&entry=${OTHER_ENTRY}`,
      `/staff/alerts/compose?alert=${OTHER_ALERT}&entry=01900000-0000-7000-8000-00000000e179`,
    ]);
  });

  it("lists drills in a section of their own, tagged, and never among the real alerts", () => {
    const view = incidentsView({ waiting: [row({ isDrill: true })], mine: [row({ isDrill: true, entryId: OTHER_ENTRY }), row({ entryId: "01900000-0000-7000-8000-00000000e179" })] }, "admin");
    expect(view.waiting?.items).toHaveLength(0);
    expect(view.mine.items).toHaveLength(1);
    expect(view.drills?.items.map((item) => item.drill)).toEqual([true, true]);
    expect(view.drills?.title).toBe("Drills");
    expect(incidentsView(none, "admin").drills).toBeNull();
  });
});

describe("the incidents list as it is drawn", () => {
  const html = (incidents: Incidents, role: "coordinator" | "director" | "ambassador" = "coordinator") => renderToStaticMarkup(<IncidentsList view={incidentsView(incidents, role)} />);

  it("says nothing is waiting, and has no list of the person's own, when there is nothing at all", () => {
    const out = html(none);
    expect(out).toContain("Nothing is waiting for your approval.");
    expect(out).toContain("You have no alerts in progress.");
    expect(out).not.toContain('data-testid="waiting-item"');
  });

  it("draws each entry with its state, when it was submitted and a link, and the approver's note as a flagged note", () => {
    const out = html({ waiting: [row()], mine: [row({ status: "draft", submittedAt: null, returnedNote: "Say which floors.\nThen submit." })] });
    expect(out).toContain('data-testid="waiting-item"');
    expect(out).toMatch(/<a class="tap hub-link" href="\/staff\/alerts\/approve\?alert=[^"]*">Review<\/a>/);
    expect(out).toMatch(/<p role="note" class="hub-flag hub-wrap hub-preline" data-testid="returned-note">Note from the approver: Say which floors\.\nThen submit\.<\/p>/);
  });

  it("is only the person's own alerts for a Director or an Ambassador, and nothing at all when they have none", () => {
    expect(html(none, "director")).toBe(renderToStaticMarkup(<IncidentsList view={incidentsView(none, "director")} />));
    expect(html(none, "director")).not.toContain("approval");
    expect(html({ waiting: [], mine: [row({ status: "draft", submittedAt: null })] }, "ambassador")).toContain("Your alerts");
  });
});
