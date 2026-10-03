import { BUILDINGS } from "./choices-fixture";
import { feedOf, NOW } from "./home-fixture";

// A feed with alerts for the tailoring tests (S04.09), answered by the stub in home-fixture.ts. The four threads are given in this order; a phone that
// saved the first building and the group "seniors" must see MINE and SENIORS_AREA first (in that order), then FAR and FAMILIES_AREA, with none missing.

const ID = (n: number) => `0198a000-0000-7000-8000-0000000f${String(n).padStart(4, "0")}`;
const HASH = "b".repeat(64);

export const THREADS = {
  FAR: "farfarfa",
  FAMILIES_AREA: "famfamfa",
  MINE: "minemine",
  SENIORS_AREA: "senarea2",
} as const;

export const SAVED_BUILDING = BUILDINGS[0].rsn;
export const FAR_BUILDING = BUILDINGS[3].rsn;

type Audience =
  | { scope: "neighbourhood"; neighbourhood_ids: string[]; groups: string[]; types: string[] }
  | { scope: "buildings"; buildings: { rsn: string; floors: string[] | null }[]; groups: string[]; types: string[] };

function thread(n: number, slug: string, types: string[], audience: Audience, words: string) {
  return {
    id: ID(n),
    slug,
    types,
    audience,
    state: "open",
    valid_until: "2026-10-01T22:00:00.000Z",
    entries: [
      {
        id: ID(n + 100),
        kind: "ack",
        phase: "problem",
        verified: true,
        attribution: { role: "hub" },
        published_at: "2026-10-01T11:00:00.000Z",
        text: { lang: "en", body: words, machine: false, model: null, status: "source", source_hash: HASH },
        original: { lang: "en", body: words },
      },
    ],
  };
}

export const WORDS = {
  [THREADS.FAR]: "The elevator at 10 Overlea Blvd is out of service.",
  [THREADS.FAMILIES_AREA]: "Heat warning for Thorncliffe Park.",
  [THREADS.MINE]: "The elevator at 4 Milepost Pl is out of service.",
  [THREADS.SENIORS_AREA]: "Heat check for Thorncliffe Park.",
} as const;

/** FeedV1 with the four threads above, in this order, and every place at none. */
export function feedWithAlerts(): ReturnType<typeof feedOf> {
  return {
    ...feedOf(3),
    server_now: NOW,
    threads: ([
      thread(1, THREADS.FAR, ["elevator"], { scope: "buildings", buildings: [{ rsn: FAR_BUILDING, floors: null }], groups: [], types: ["elevator"] }, WORDS[THREADS.FAR]),
      thread(2, THREADS.FAMILIES_AREA, ["heat"], { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: ["families"], types: ["heat"] }, WORDS[THREADS.FAMILIES_AREA]),
      thread(3, THREADS.MINE, ["elevator"], { scope: "buildings", buildings: [{ rsn: SAVED_BUILDING, floors: null }], groups: [], types: ["elevator"] }, WORDS[THREADS.MINE]),
      thread(4, THREADS.SENIORS_AREA, ["heat"], { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: ["seniors"], types: ["heat"] }, WORDS[THREADS.SENIORS_AREA]),
    ]) as never[],
  };
}
