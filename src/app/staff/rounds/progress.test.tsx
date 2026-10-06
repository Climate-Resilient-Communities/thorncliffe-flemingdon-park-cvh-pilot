import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TALLY_STATUSES, countsByPlace, type TallyCount } from "@/modules/checkins";
import { TALLY_COUNTS, progressScreen, unreadableProgress, type ProgressRound, type ProgressSources } from "./progress";
import { RoundProgress } from "./RoundProgress";
import { RoundsBody } from "./RoundsBody";
import { roundsScreen } from "./view";

const HEAT = "0199b6f2-0000-7000-8000-000000000001";
const POWER = "0199b6f2-0000-7000-8000-000000000002";
const CLOSED = "0199b6f2-0000-7000-8000-000000000003";
const QUIET = "0199b6f2-0000-7000-8000-000000000004";
const PLANS = [
  { rsn: "7002", address: "4 Milepost Pl", floors: [{ id: "m1", label: "1" }] },
  { rsn: "7001", address: "85 Thorncliffe Park Dr", floors: [{ id: "t1", label: "1" }, { id: "t2", label: "2" }, { id: "t12", label: "12" }] },
];
// The rows as the app reads them carry the subscriber's id and the round_ref; the counts never show either.
const row = (alertId: string, rsn: string, floorId: string, status: "pending" | "done" | "not_reached" | "needs_help", n: number) => ({
  alertId,
  rsn,
  floorId,
  status,
  subscriberId: `subscriber-${n}`,
  roundRef: `4a1f0c2e-0000-4000-8000-00000000000${n}`,
  method: "call" as const,
});
const tally = (rsn: string, floorId: string, status: TallyCount["status"], n: number): TallyCount => ({ alertId: CLOSED, rsn, floorId, status, n });

const SOURCES: ProgressSources = {
  rows: [
    row(HEAT, "7001", "t12", "pending", 1),
    row(HEAT, "7001", "t2", "done", 2),
    row(HEAT, "7001", "t12", "needs_help", 3),
    row(HEAT, "7002", "m1", "not_reached", 4),
    row(HEAT, "7001", "gone", "pending", 5),
    row(POWER, "7001", "t1", "pending", 6),
    // A thread that is not an open one residents read (closed before its rows were tallied): not counted.
    row("0199b6f2-0000-7000-8000-00000000dead", "7001", "t1", "done", 7),
  ],
  headlines: new Map([
    [HEAT, "Extreme heat. Cooling centres are open."],
    [POWER, "Power is out at 85 Thorncliffe Park Dr."],
  ]),
  closed: [
    { alertId: CLOSED, types: ["power"], closedAt: new Date("2026-10-05T22:10:00Z") },
    { alertId: QUIET, types: ["water"], closedAt: new Date("2026-10-04T12:00:00Z") },
  ],
  closedPlaces: countsByPlace([
    tally("7001", "t2", "requested", 3),
    tally("7001", "t2", "done", 1),
    tally("7001", "t2", "withdrawn", 1),
    tally("7001", "t2", "unmarked", 1),
    tally("7002", "m1", "requested", 2),
    tally("7002", "m1", "needs_help", 1),
    tally("7002", "m1", "not_reached", 1),
  ]),
  plans: PLANS,
};

const counts = (round: ProgressRound) => round.buildings.map((building) => [building.address, building.floors.map((floor) => [floor.label, Object.fromEntries(floor.counts.map((c) => [c.status, c.n]))])]);

describe("the rounds' counts by building and floor (O-17, S08.09)", () => {
  const screen = progressScreen(SOURCES);

  it("counts each open round's requests as they are now, by latest mark, building by address and floor by the building's order", () => {
    expect(screen.open.map((round) => round.title)).toEqual(["Round for: Extreme heat. Cooling centres are open.", "Round for: Power is out at 85 Thorncliffe Park Dr."]);
    expect(counts(screen.open[0]!)).toEqual([
      ["4 Milepost Pl", [["Floor 1", { requests: 1, pending: 0, done: 0, not_reached: 1, needs_help: 0 }]]],
      [
        "85 Thorncliffe Park Dr",
        [
          ["Floor 2", { requests: 1, pending: 0, done: 1, not_reached: 0, needs_help: 0 }],
          ["Floor 12", { requests: 2, pending: 1, done: 0, not_reached: 0, needs_help: 1 }],
          // A floor removed from its building since the request: after the building's own floors.
          ["A floor removed since", { requests: 1, pending: 1, done: 0, not_reached: 0, needs_help: 0 }],
        ],
      ],
    ]);
    expect(screen.open[0]!.total.map((count) => count.text)).toEqual(["Asked now: 5", "Still to do: 2", "Done: 1", "Not reached: 1", "Needs help: 1"]);
  });

  it("lists the tally's statuses in checkins' own order", () => {
    expect(TALLY_COUNTS).toEqual(TALLY_STATUSES);
  });

  it("gives a closed round its tally, every status at every floor, which add up to what was asked; a closed thread with no request is not listed", () => {
    expect(screen.closed.map((round) => round.title)).toEqual(["Power: round closed Monday, October 5, 2026 at 6:10 p.m. EDT"]);
    expect(counts(screen.closed[0]!)).toEqual([
      ["4 Milepost Pl", [["Floor 1", { requested: 2, done: 0, not_reached: 1, needs_help: 1, withdrawn: 0, unmarked: 0 }]]],
      ["85 Thorncliffe Park Dr", [["Floor 2", { requested: 3, done: 1, not_reached: 0, needs_help: 0, withdrawn: 1, unmarked: 1 }]]],
    ]);
    expect(screen.closed[0]!.total.map((count) => count.text)).toEqual(["Asked: 5", "Done: 1", "Not reached: 1", "Needs help: 1", "Withdrawn: 1", "Not marked: 1"]);
  });

  it("draws the counts, and never a subscriber, a round_ref or a number", () => {
    const html = renderToStaticMarkup(<RoundProgress progress={screen} />);
    expect(html).toContain("Round progress by building and floor");
    expect(html).toContain("Rounds closed in the last 7 days");
    expect(html).toContain('data-count="needs_help" data-n="1"');
    expect(html.match(/data-testid="progress-floor"/g)).toHaveLength(7);
    expect(html).not.toMatch(/subscriber-|4a1f0c2e|\+1\d{10}/);
  });

  it("says when no round is running or closed lately, and when the counts cannot be read", () => {
    const none = renderToStaticMarkup(<RoundProgress progress={progressScreen({ ...SOURCES, rows: [], closedPlaces: [] })} />);
    expect(none).toContain("No check-in round is running now.");
    expect(none).toContain("No round closed in the last 7 days.");
    const unreadable = renderToStaticMarkup(<RoundProgress progress={unreadableProgress()} />);
    expect(unreadable).toContain("The Hub could not read the round counts.");
    expect(unreadable).not.toContain("Rounds closed in the last 7 days");
  });

  it("is on the page below the escalations for the roles that see counts, and left out for any other", () => {
    const withCounts = renderToStaticMarkup(<RoundsBody screen={roundsScreen([])} progress={screen} />);
    expect(withCounts.indexOf("To follow up")).toBeLessThan(withCounts.indexOf("Round progress by building and floor"));
    expect(renderToStaticMarkup(<RoundsBody screen={roundsScreen([])} progress={null} />)).not.toContain("Round progress");
  });
});
