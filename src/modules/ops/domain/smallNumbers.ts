// The small-number rule (E09 "Small-number rule") for the figures the pilot measures export adds up itself (S09.05): the counts of the views that give them as
// they are (db/migrations/20261006200000_pilot_measures.sql), the counts left after the alerts sent for a rehearsal are taken out, and the translation survey's
// file. The views of S07.10 and S09.04 apply the same rule in SQL; their figures arrive hidden and pass through unchanged. Pure.
//
// The rule: a count of 1 to 4 is shown as "fewer than 5"; a percentage whose numerator or denominator is 1 to 4 (or hidden) is not shown; and where a total and
// the other visible cells of its split would reveal one hidden cell, the smallest visible cell of 5 or more is hidden as well, as "not shown" (it may be 5 or
// more, so it is not "fewer than 5"). A split with two hidden cells reveals neither. Zero is shown as 0 and is never the cell hidden for another, since a reader
// who knows the rule would then read the hidden total as the small cell. The rule is applied along each split (a total and its cells by language, by
// neighbourhood, by building or by floor), as the views of S07.10 and S09.04 apply it.
import { FEWER_THAN_FIVE } from "./weeklyReview";

/** What is printed for a cell hidden only to protect another (S07.10's word). */
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

/**
 * A total and its split into cells, each judged by the rule. `cells` are in the order given; the total is their sum. When exactly one cell is hidden as 1 to 4
 * and the total is shown, the smallest cell of 5 or more (the first given of equal ones) is hidden as well, so the total cannot give the hidden one away.
 */
export function shownSplit<K>(cells: readonly { key: K; n: number }[]): { total: Shown; cells: { key: K; count: Shown }[] } {
  const total = cells.reduce((sum, cell) => sum + cell.n, 0);
  const small = cells.filter((cell) => isSmall(cell.n)).length;
  let protector = -1;
  if (small === 1 && !isSmall(total)) {
    cells.forEach((cell, index) => {
      if (cell.n >= 5 && (protector === -1 || cell.n < cells[protector].n)) protector = index;
    });
  }
  return {
    total: shownCount(total),
    cells: cells.map((cell, index) => ({ key: cell.key, count: index === protector ? { n: null, shown: NOT_SHOWN } : shownCount(cell.n) })),
  };
}

/** A floor percentage of two shown counts, or null (not shown) when either is hidden or the denominator is zero. */
export function shownPercent(numerator: Shown, denominator: Shown): number | null {
  if (numerator.n === null || denominator.n === null || denominator.n === 0) return null;
  return Math.floor((100 * numerator.n) / denominator.n);
}

/** True when a written value is a count the rule should have hidden: a whole number from 1 to 4. The export checks every count it writes with it. */
export const revealsSmallCount = (value: string): boolean => /^[1-4]$/.test(value.trim());
