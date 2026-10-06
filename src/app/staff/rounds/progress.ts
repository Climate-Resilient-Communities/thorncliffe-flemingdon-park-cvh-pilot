// What "Check-in rounds" (O-17) shows of the rounds' counts by building and floor (S08.09; E08 definition "Round tally"), from what the app composes
// (load.ts): pure, so the tests and the screenshots draw the very same words.
//  - An open round: its requests as they are now (the live rows of its thread, whose requester still asks), by their latest mark: still to do, done, not
//    reached, needs help. Never the tally: a row adds its outcome there only when it leaves the round, so the tally cannot say how a round is going.
//  - A round closed in the last 7 days: its tally, kept after its rows are gone: asked, then each outcome (done, not reached, needs help, withdrawn, not
//    marked), which add up to what was asked at every place.
// Counts only: no row, `round_ref`, subscriber or number is read for this view, so none can be shown, whoever looks. Only types come from the checkins
// module, so the screenshots' fixtures draw it without the server's code.
import { englishText } from "@/i18n/text";
import { formatTorontoDateTime } from "@/platform/clock";
import type { PlaceCounts, TallyStatus } from "@/modules/checkins";
import type { RowStatus } from "@/contracts/checkinRound";
import { typeName } from "../alerts/typeNames";
import type { RoundPlan } from "../ambassador/round/compose";

/** How long a closed round's counts stay on the page, in days (the escalations handled are listed as long). */
export const CLOSED_ROUNDS_DAYS = 7;

/** The tally's statuses, in the order the page lists them: what was asked, then the outcomes (checkins' TALLY_STATUSES; a test compares them). */
export const TALLY_COUNTS = ["requested", "done", "not_reached", "needs_help", "withdrawn", "unmarked"] as const satisfies readonly TallyStatus[];

/** The live statuses, in the order the page lists them: the requests now, then by latest mark. */
export const LIVE_COUNTS = ["requests", "pending", "done", "not_reached", "needs_help"] as const;
type LiveCount = (typeof LIVE_COUNTS)[number];

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.rounds.progress.${key}`, values);

/** A live row as the counts read it: its thread, its place and its latest mark (never its subscriber or `round_ref`). */
export interface ProgressRow {
  alertId: string;
  rsn: string;
  floorId: string;
  status: RowStatus;
}

/** A closed round's counts at one building and floor (checkins' `countsByPlace` of its tally). */
export interface ClosedPlace {
  alertId: string;
  rsn: string;
  floorId: string;
  counts: PlaceCounts;
}

/** A thread that closed lately and is not a drill: its types and when it closed (alerting's `closedThreads`). */
export interface ClosedRoundThread {
  alertId: string;
  types: readonly string[];
  closedAt: Date;
}

export interface ProgressSources {
  /** The live rows of the open rounds, oldest first. */
  rows: readonly ProgressRow[];
  /** The open threads residents read, with the words that cover each (alerting's `openHeadlines`). */
  headlines: ReadonlyMap<string, string>;
  /** The threads closed in the last CLOSED_ROUNDS_DAYS, the most recently closed first. */
  closed: readonly ClosedRoundThread[];
  /** The tally of those threads by place (checkins' `roundTallies`, gathered by `countsByPlace`). */
  closedPlaces: readonly ClosedPlace[];
  /** The buildings of the rows and tallies, by address, with their floors in the building's own order. */
  plans: readonly RoundPlan[];
}

export interface ProgressCount {
  status: string;
  n: number;
  text: string;
}

export interface ProgressFloor {
  key: string;
  label: string;
  counts: ProgressCount[];
}

export interface ProgressBuilding {
  rsn: string;
  address: string;
  floors: ProgressFloor[];
}

export interface ProgressRound {
  alertId: string;
  title: string;
  /** The round's counts over every building and floor. */
  total: ProgressCount[];
  buildings: ProgressBuilding[];
}

export interface ProgressScreen {
  open: ProgressRound[];
  closed: ProgressRound[];
  /** The counts could not be read: the page says so. */
  unreadable: boolean;
}

export const unreadableProgress = (): ProgressScreen => ({ open: [], closed: [], unreadable: true });

const liveLabel = (status: LiveCount) => t(`live.${status}`);
const countOf = (status: string, label: string, n: number): ProgressCount => ({ status, n, text: t("count", { label, n }) });
const liveCounts = (counts: Record<LiveCount, number>) => LIVE_COUNTS.map((status) => countOf(status, liveLabel(status), counts[status]));
const tallyCounts = (counts: PlaceCounts) => TALLY_COUNTS.map((status) => countOf(status, t(`tally.${status}`), counts[status]));

/**
 * One round's places as buildings and floors: the buildings in the order of `plans` (by address), each building's floors in its own order, and a floor
 * removed from its building since (no label any more) after them.
 */
function placesOf<C>(places: readonly { rsn: string; floorId: string; counts: C }[], plans: readonly RoundPlan[], draw: (counts: C) => ProgressCount[]): ProgressBuilding[] {
  const order = new Map(plans.map((plan, index) => [plan.rsn, index]));
  const plan = new Map(plans.map((each) => [each.rsn, each]));
  const rank = (rsn: string) => order.get(rsn) ?? Number.MAX_SAFE_INTEGER;
  const buildings = [...new Set(places.map((place) => place.rsn))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return buildings.map((rsn) => {
    const floors = plan.get(rsn)?.floors ?? [];
    const floorRank = (floorId: string) => {
      const index = floors.findIndex((floor) => floor.id === floorId);
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };
    return {
      rsn,
      address: plan.get(rsn)?.address ?? rsn,
      floors: places
        .filter((place) => place.rsn === rsn)
        .sort((a, b) => floorRank(a.floorId) - floorRank(b.floorId) || a.floorId.localeCompare(b.floorId))
        .map((place) => {
          const label = floors.find((floor) => floor.id === place.floorId)?.label;
          return { key: `${rsn} ${place.floorId}`, label: label === undefined ? t("floorGone") : t("floor", { floor: label }), counts: draw(place.counts) };
        }),
    };
  });
}

const noLive = (): Record<LiveCount, number> => ({ requests: 0, pending: 0, done: 0, not_reached: 0, needs_help: 0 });

/** The open rounds with a request now, the oldest request's round first: each floor's requests by latest mark. */
function openRounds(sources: ProgressSources): ProgressRound[] {
  const threads = new Map<string, Map<string, { rsn: string; floorId: string; counts: Record<LiveCount, number> }>>();
  for (const row of sources.rows) {
    if (!sources.headlines.has(row.alertId)) continue;
    const places = threads.get(row.alertId) ?? new Map();
    threads.set(row.alertId, places);
    const key = `${row.rsn} ${row.floorId}`;
    const place = places.get(key) ?? { rsn: row.rsn, floorId: row.floorId, counts: noLive() };
    places.set(key, place);
    place.counts.requests += 1;
    place.counts[row.status] += 1;
  }
  return [...threads.entries()].map(([alertId, places]) => {
    const total = noLive();
    for (const place of places.values()) for (const status of LIVE_COUNTS) total[status] += place.counts[status];
    return {
      alertId,
      title: t("forAlert", { headline: sources.headlines.get(alertId) ?? "" }),
      total: liveCounts(total),
      buildings: placesOf([...places.values()], sources.plans, liveCounts),
    };
  });
}

/** The rounds closed lately that had a request, the most recently closed first: each floor's tally. */
function closedRounds(sources: ProgressSources): ProgressRound[] {
  return sources.closed.flatMap((thread) => {
    const mine = sources.closedPlaces.filter((place) => place.alertId === thread.alertId);
    if (mine.length === 0) return [];
    const total = Object.fromEntries(TALLY_COUNTS.map((status) => [status, mine.reduce((sum, place) => sum + place.counts[status], 0)])) as PlaceCounts;
    return [
      {
        alertId: thread.alertId,
        title: t("closedTitle", { types: thread.types.map(typeName).join(", "), time: formatTorontoDateTime(thread.closedAt) }),
        total: tallyCounts(total),
        buildings: placesOf(mine, sources.plans, tallyCounts),
      },
    ];
  });
}

/** The counts the page shows: the open rounds' live counts, then the counts kept of the rounds closed lately. */
export function progressScreen(sources: ProgressSources): ProgressScreen {
  return { open: openRounds(sources), closed: closedRounds(sources), unreadable: false };
}
