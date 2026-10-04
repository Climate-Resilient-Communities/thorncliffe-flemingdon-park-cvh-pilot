// The data the A-03 screens (S08.04) are drawn from in the layout and screenshot specs: an ambassador's own post in each state, built the way the page builds it
// (src/app/staff/ambassador/status/view.ts), with the app's own functions making the view.
import type { AmbassadorPostState, AmbassadorPostStatus } from "../../src/modules/alerting";
import { statusScreen, type StatusData, type StatusScreen, type Text, type TextCounts } from "../../src/app/staff/ambassador/status/view";

export const ALERT = "01900000-0000-7000-8000-00000000a1e7";
export const ENTRY = "01900000-0000-7000-8000-00000000e17a";
export const RSN = "4154146";
export const ADDRESS = "4 Milepost Pl";
const IDS = { correct: "01900000-0000-7000-8000-00000000c001", withdraw: "01900000-0000-7000-8000-00000000c002", resolve: "01900000-0000-7000-8000-00000000c003" };
export const FLOORS = ["G", "1", "2", "3", "4", "5"].map((label, index) => ({ id: `01900000-0000-7000-8000-0000000f${String(index + 1).padStart(4, "0")}`, label }));

export const COUNTS: TextCounts = { waiting: 12, inFlight: 40, delivered: 311, undelivered: 3, failed: 2, unknown: 1, cancelled: 0, skipped: 0 };

export const status = (state: AmbassadorPostState, over: Partial<AmbassadorPostStatus> = {}): AmbassadorPostStatus => ({
  entryId: ENTRY,
  alertId: ALERT,
  slug: "abcd2345",
  kind: "update",
  types: ["water", "elevator"],
  text: "No water on floors 3 to 5 since this morning, and the elevator is out. Please use the stairs with care.",
  phase: "problem",
  state,
  note: null,
  buildings: [{ rsn: RSN, floors: [FLOORS[3].id, FLOORS[4].id, FLOORS[5].id] }],
  postedAt: new Date("2026-10-04T18:30:00.000Z"),
  approvedAt: null,
  validUntil: new Date("2026-10-05T18:30:00.000Z"),
  replacedWith: null,
  waitingReplacement: null,
  waitingFinal: false,
  threadOpen: true,
  can: { replace: false, resolve: false },
  ...over,
});

export function screenOf(state: AmbassadorPostState, over: Partial<AmbassadorPostStatus> = {}, rest: Partial<StatusData> = {}, text?: Text): StatusScreen {
  const data: StatusData = {
    status: status(state, over),
    addresses: new Map([[RSN, ADDRESS]]),
    floorLabels: new Map(FLOORS.map((floor) => [floor.id, floor.label])),
    counts: null,
    ids: IDS,
    ...rest,
  };
  return statusScreen(data, text);
}
