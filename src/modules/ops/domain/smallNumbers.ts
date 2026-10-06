// The small-number rule (E09 "Small-number rule") for the figures the pilot measures export adds up itself (S09.05): the counts of the views that give them as
// they are (db/migrations/20261006200000_pilot_measures.sql), the counts left after the alerts sent for a rehearsal are taken out, and the translation survey's
// file. S07.10's views apply the rule in SQL; their figures arrive hidden and pass through unchanged (they hide one more cell for one hidden cell only, which
// leaves the cases below open: a follow-up for them and for S09.04's weekly review). Pure.
//
// The rule: a count of 1 to 4 is shown as "fewer than 5"; a percentage whose numerator or denominator is 1 to 4 (or hidden) is not shown; and where a total and
// the other visible figures would reveal a hidden one, one more figure is hidden, as "not shown" (it is 5 or more, so it is not "fewer than 5"). Zero is shown
// as 0 and is never the figure hidden for another. "Reveal" is judged as a reader who knows this rule would: a hidden figure is revealed when the totals, the
// visible figures and what each hidden figure's words say of it (1 to 4, or 5 or more) leave it one possible value. So two hidden figures that the total
// leaves 2 between them (both 1), or 8 (both 4), are revealed as surely as one, and so is a "fewer than 5" whose "not shown" partner leaves them 6 (1 and 5).
// A total of 1 to 4 is not split at all: its parts are 0 or 1 to 4, and how many of them are listed could give them away (four parts of a total of 4 are 1
// each), so they are left out. The figures are judged together as a table of totals (shownTable): a total may have several splits (by language and by
// neighbourhood), and a part may be the total of a split of its own (a round, its buildings, their floors).
import { FEWER_THAN_FIVE } from "./weeklyReview";

/** What is printed for a figure hidden only to protect another (S07.10's word). */
export const NOT_SHOWN = "not shown";

/** A count as the export writes it: the number, or null where the rule hides it, and the text to print either way. */
export interface Shown {
  n: number | null;
  shown: string;
}

/** A count of 1 to 4: the rule hides it. */
export const isSmall = (n: number): boolean => n >= 1 && n <= 4;

/** One count on its own (a total, or a count that is no cell of a split). */
export function shownCount(n: number): Shown {
  return isSmall(n) ? { n: null, shown: FEWER_THAN_FIVE } : { n, shown: String(n) };
}

/** A count that arrives already judged by a view of S07.10 or S09.04: what the view showed. */
export const viewCount = (n: number | null, shown: string): Shown => ({ n, shown });

/** A split in a table of figures: a total and its parts, each by its key; the total is the sum of the parts. */
export interface TableSplit {
  total: string;
  parts: readonly string[];
}

/** The least and the most a figure can be, as a reader who knows the rule can work it out. */
interface Range {
  lo: number;
  hi: number;
}

const NO_LIMIT = Number.POSITIVE_INFINITY;

function narrow(range: Range, lo: number, hi: number): boolean {
  if (lo <= range.lo && hi >= range.hi) return false;
  range.lo = Math.max(range.lo, lo);
  range.hi = Math.min(range.hi, hi);
  return true;
}

/**
 * What a reader can work out of every figure: a visible one is what it reads, a "fewer than 5" is 1 to 4 and a "not shown" 5 or more; then every split narrows
 * its total to what its parts allow, and each part to what the total leaves after the other parts, until nothing changes. The ranges always hold the true
 * figure, so this ends. For splits that form a tree (no two splits share more than one figure, and no figure is reached from another along two paths of
 * splits), each range is exactly the values the figure can take: a sum of whole numbers between bounds takes every value between its bounds, so a range
 * that holds after every split holds for the whole tree.
 */
function ranges(values: ReadonlyMap<string, number>, splits: readonly TableSplit[], hidden: ReadonlyMap<string, "small" | "protector">): Map<string, Range> {
  const range = new Map<string, Range>();
  for (const [key, n] of values) {
    const state = hidden.get(key);
    range.set(key, state === undefined ? { lo: n, hi: n } : state === "small" ? { lo: 1, hi: 4 } : { lo: 5, hi: NO_LIMIT });
  }
  for (let changed = true, rounds = 0; changed; rounds += 1) {
    if (rounds > 10_000) throw new Error("small-number rule: the ranges did not settle");
    changed = false;
    for (const split of splits) {
      const total = range.get(split.total)!;
      const parts = split.parts.map((key) => range.get(key)!);
      const sumLo = parts.reduce((sum, part) => sum + part.lo, 0);
      const unlimited = parts.filter((part) => part.hi === NO_LIMIT).length;
      const finiteHi = parts.reduce((sum, part) => (part.hi === NO_LIMIT ? sum : sum + part.hi), 0);
      changed = narrow(total, sumLo, unlimited > 0 ? NO_LIMIT : finiteHi) || changed;
      for (const part of parts) {
        const othersHi = unlimited - (part.hi === NO_LIMIT ? 1 : 0) > 0 ? NO_LIMIT : finiteHi - (part.hi === NO_LIMIT ? 0 : part.hi);
        changed = narrow(part, total.lo - othersHi, total.hi - (sumLo - part.lo)) || changed;
      }
    }
  }
  return range;
}

/**
 * The figure to hide next when `start` can be worked out. The splits it can be worked out through are those `start` is in, then those the figures hidden in
 * them are in, and so on. The figure hidden is the smallest visible part of 5 or more (the first given of equal ones) of the nearest of those splits that has
 * one; only when none has one, the smallest visible total of the nearest that has one: a total is the figure a reader most wants, so a part goes first.
 */
function nextProtector(start: string, splits: readonly TableSplit[], values: ReadonlyMap<string, number>, hidden: ReadonlyMap<string, unknown>, rank: ReadonlyMap<string, number>): string | null {
  const reached = new Set([start]);
  const used = new Set<TableSplit>();
  const levels: TableSplit[][] = [];
  for (let frontier = new Set([start]); frontier.size > 0; ) {
    const level = splits.filter((split) => !used.has(split) && (frontier.has(split.total) || split.parts.some((key) => frontier.has(key))));
    for (const split of level) used.add(split);
    levels.push(level);
    frontier = new Set(level.flatMap((split) => [split.total, ...split.parts]).filter((key) => hidden.has(key) && !reached.has(key)));
    for (const key of frontier) reached.add(key);
  }
  const smallest = (keys: readonly string[]) =>
    keys.filter((key) => !hidden.has(key) && values.get(key)! >= 5).sort((a, b) => values.get(a)! - values.get(b)! || rank.get(a)! - rank.get(b)!)[0];
  for (const level of levels) {
    const part = smallest(level.flatMap((split) => split.parts));
    if (part !== undefined) return part;
  }
  for (const level of levels) {
    const total = smallest(level.map((split) => split.total));
    if (total !== undefined) return total;
  }
  return null;
}

/**
 * A table of figures connected by totals, judged by the rule. `values` holds every figure by its key, in the order the export lists them (ties are settled by
 * it); `splits` says which figures are totals of which. The result holds every key: the figure as shown, or null where it is left out (a part of a total of 1
 * to 4, and the parts of those parts). One more figure is hidden at a time, next to the first hidden figure that can still be worked out, until none can be.
 *
 * The working out is exact when the splits form a tree (see `ranges`), which is how the export lays out every table it judges; a table with two paths between
 * its figures (a round's statuses by floor, added up again by building) could hide a figure that a reader solving the whole table would still find.
 */
export function shownTable(values: ReadonlyMap<string, number>, splits: readonly TableSplit[]): Map<string, Shown | null> {
  const valueOf = (key: string) => {
    const n = values.get(key);
    if (n === undefined) throw new Error(`small-number rule: no figure for "${key}"`);
    return n;
  };
  for (const split of splits) {
    if (split.parts.reduce((sum, key) => sum + valueOf(key), 0) !== valueOf(split.total)) throw new Error(`small-number rule: "${split.total}" is not the sum of its parts`);
  }
  // A total of 1 to 4 is not split; nor are the parts it leaves out.
  const leftOut = new Set<string>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const split of splits) {
      if (!isSmall(valueOf(split.total)) && !leftOut.has(split.total)) continue;
      for (const key of split.parts) {
        if (!leftOut.has(key)) {
          leftOut.add(key);
          grew = true;
        }
      }
    }
  }
  const live = splits.filter((split) => !isSmall(valueOf(split.total)) && !leftOut.has(split.total));
  const order = [...values.keys()];
  const rank = new Map(order.map((key, index) => [key, index]));
  const hidden = new Map<string, "small" | "protector">();
  for (const key of order) if (!leftOut.has(key) && isSmall(valueOf(key))) hidden.set(key, "small");
  for (;;) {
    const range = ranges(values, live, hidden);
    const revealed = order.find((key) => hidden.get(key) === "small" && range.get(key)!.lo === range.get(key)!.hi);
    if (revealed === undefined) break;
    const protector = nextProtector(revealed, live, values, hidden, rank);
    // Every figure of 1 or more is hidden by then, and then none can be worked out (a total of 1 to 4 is not split): a failure here is a bug, and it stops
    // the export rather than write a figure the rule hides.
    if (protector === null) throw new Error(`small-number rule: "${revealed}" can be worked out and nothing is left to hide`);
    hidden.set(protector, "protector");
  }
  return new Map(
    order.map((key) => {
      if (leftOut.has(key)) return [key, null];
      const state = hidden.get(key);
      return [key, state === "small" ? { n: null, shown: FEWER_THAN_FIVE } : state === "protector" ? { n: null, shown: NOT_SHOWN } : { n: valueOf(key), shown: String(valueOf(key)) }];
    }),
  );
}

/**
 * One total split several ways (by language and by neighbourhood), each split's cells in the order given; every split must add up to the same total. A cell is
 * null where it is left out (the total is 1 to 4).
 */
export function shownSplits<K>(splits: readonly (readonly { key: K; n: number }[])[]): { total: Shown; splits: { key: K; count: Shown | null }[][] } {
  const sums = splits.map((cells) => cells.reduce((sum, cell) => sum + cell.n, 0));
  const total = sums[0] ?? 0;
  if (sums.some((sum) => sum !== total)) throw new Error("small-number rule: the splits of one total do not add up to the same figure");
  const values = new Map<string, number>([["total", total]]);
  splits.forEach((cells, s) => cells.forEach((cell, index) => values.set(`${s}.${index}`, cell.n)));
  const judged = shownTable(
    values,
    splits.map((cells, s) => ({ total: "total", parts: cells.map((_, index) => `${s}.${index}`) })),
  );
  return {
    total: judged.get("total")!,
    splits: splits.map((cells, s) => cells.map((cell, index) => ({ key: cell.key, count: judged.get(`${s}.${index}`) ?? null }))),
  };
}

/** A total and one split of it: `shownSplits` with one split. */
export function shownSplit<K>(cells: readonly { key: K; n: number }[]): { total: Shown; cells: { key: K; count: Shown | null }[] } {
  const judged = shownSplits([cells]);
  return { total: judged.total, cells: judged.splits[0] };
}

/** A floor percentage of two shown counts, or null (not shown) when either is hidden or left out, or the denominator is zero. */
export function shownPercent(numerator: Shown | null, denominator: Shown | null): number | null {
  if (numerator === null || denominator === null || numerator.n === null || denominator.n === null || denominator.n === 0) return null;
  return Math.floor((100 * numerator.n) / denominator.n);
}

/** True when a written value is a count the rule should have hidden: a whole number from 1 to 4. The export checks every count it writes with it. */
export const revealsSmallCount = (value: string): boolean => /^[1-4]$/.test(value.trim());
