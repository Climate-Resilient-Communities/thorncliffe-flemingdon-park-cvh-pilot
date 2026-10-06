import { describe, expect, it } from "vitest";
import { NOT_SHOWN, isSmall, revealsSmallCount, shownCount, shownPercent, shownSplit, shownSplits, shownTable, type Shown, type TableSplit } from "./smallNumbers";

// E09's small-number rule as the pilot measures export applies it (S09.05): 1 to 4 hidden, more figures hidden until a reader who knows the rule can work none
// of them out from the totals, a total of 1 to 4 not split, a percentage from a hidden or small figure not shown, zero shown.

const cells = (split: ReturnType<typeof shownSplit<string>>) => split.cells.map((cell) => `${cell.key}=${cell.count?.shown ?? "left out"}`);
const split = (counts: number[]) => shownSplit(counts.map((n, index) => ({ key: String.fromCharCode(97 + index), n })));

describe("one count", () => {
  it("shows 0 and 5 or more, and hides 1 to 4 as 'fewer than 5'", () => {
    expect(shownCount(0)).toEqual({ n: 0, shown: "0" });
    for (const n of [1, 2, 3, 4]) expect(shownCount(n)).toEqual({ n: null, shown: "fewer than 5" });
    expect(shownCount(5)).toEqual({ n: 5, shown: "5" });
    expect(shownCount(1234)).toEqual({ n: 1234, shown: "1234" });
    expect([0, 1, 4, 5].map(isSmall)).toEqual([false, true, true, false]);
  });
});

describe("a total and its split", () => {
  it("hides the smallest cell of 5 or more as 'not shown' when exactly one cell is 1 to 4 and the total is shown", () => {
    const judged = shownSplit([
      { key: "en", n: 40 },
      { key: "ur", n: 3 },
      { key: "ps", n: 9 },
      { key: "tl", n: 0 },
    ]);
    expect(judged.total).toEqual({ n: 52, shown: "52" });
    expect(cells(judged)).toEqual(["en=40", "ur=fewer than 5", `ps=${NOT_SHOWN}`, "tl=0"]);
    expect(judged.cells[2].count?.n).toBeNull();
  });

  it("hides nothing more when two cells of 1 to 4 can still be told apart from the total: 3 and 2 could be 1 and 4", () => {
    expect(cells(split([40, 3, 2]))).toEqual(["a=40", "b=fewer than 5", "c=fewer than 5"]);
  });

  it("hides one more cell when the cells of 1 to 4 leave no choice: two that add up to 2 are 1 each, two that add up to 8 are 4 each", () => {
    for (const counts of [
      [1, 1, 30],
      [4, 4, 30],
      [1, 1, 20],
      [4, 4, 20],
    ]) {
      const judged = split(counts);
      expect(cells(judged), counts.join(",")).toEqual(["a=fewer than 5", "b=fewer than 5", `c=${NOT_SHOWN}`]);
      expect(judged.total.shown).toBe(String(counts[0] + counts[1] + counts[2]));
    }
  });

  it("hides a third cell when a 'fewer than 5' and its 'not shown' leave 6 between them (only 1 and 5 add up to 6)", () => {
    const judged = split([1, 5, 20]);
    expect(judged.total.shown).toBe("26");
    expect(cells(judged)).toEqual(["a=fewer than 5", `b=${NOT_SHOWN}`, `c=${NOT_SHOWN}`]);
  });

  it("hides the total when no cell of 5 or more is left to hide", () => {
    const judged = split([4, 4, 0]);
    expect(judged.total.shown).toBe(NOT_SHOWN);
    expect(cells(judged)).toEqual(["a=fewer than 5", "b=fewer than 5", "c=0"]);
  });

  it("never hides a zero for another cell, and takes the first of equal cells", () => {
    expect(cells(split([0, 2, 7, 7]))).toEqual(["a=0", "b=fewer than 5", `c=${NOT_SHOWN}`, "d=7"]);
  });

  it("does not split a total of 1 to 4: its cells are left out, since four cells of a total of 4 are 1 each", () => {
    const judged = shownSplit([
      { key: "TP", n: 3 },
      { key: "FP", n: 0 },
    ]);
    expect(judged.total.shown).toBe("fewer than 5");
    expect(cells(judged)).toEqual(["TP=left out", "FP=left out"]);
    expect(cells(split([1, 1, 1, 1]))).toEqual(["a=left out", "b=left out", "c=left out", "d=left out"]);
  });

  it("shows an empty split as a total of 0", () => {
    expect(shownSplit([])).toEqual({ total: { n: 0, shown: "0" }, cells: [] });
  });
});

describe("a total split several ways", () => {
  it("judges the splits together: a split of one cell would give the hidden total away", () => {
    // Installs: Urdu 4 and Pashto 4 (no other language), all in Thorncliffe Park. The total must be hidden, and then so must Thorncliffe Park's 8.
    const judged = shownSplits([
      [
        { key: "ur", n: 4 },
        { key: "ps", n: 4 },
      ],
      [
        { key: "TP", n: 8 },
        { key: "FP", n: 0 },
      ],
    ]);
    expect(judged.total.shown).toBe(NOT_SHOWN);
    expect(judged.splits.map((cells) => cells.map((cell) => `${cell.key}=${cell.count?.shown}`))).toEqual([
      ["ur=fewer than 5", "ps=fewer than 5"],
      [`TP=${NOT_SHOWN}`, "FP=0"],
    ]);
  });

  it("refuses splits that do not add up to the same total", () => {
    expect(() => shownSplits([[{ key: "en", n: 5 }], [{ key: "TP", n: 6 }]])).toThrow(/same figure/);
  });
});

describe("a table of totals", () => {
  it("hides a floor where its building's own total would give it away, not only the thread's", () => {
    // A thread: building A (floors 20 and 2), building B (floor 5). Judged across the thread's floors alone, B's floor would be the one hidden, and A's 22
    // less its visible 20 would give the 2 away.
    const values = new Map([
      ["thread", 27],
      ["A", 22],
      ["B", 5],
      ["A1", 20],
      ["A2", 2],
      ["B1", 5],
    ]);
    const judged = shownTable(values, [
      { total: "thread", parts: ["A", "B"] },
      { total: "A", parts: ["A1", "A2"] },
      { total: "B", parts: ["B1"] },
    ]);
    expect(Object.fromEntries([...judged].map(([key, shown]) => [key, shown?.shown]))).toEqual({
      thread: "27",
      A: "22",
      B: "5",
      A1: NOT_SHOWN,
      A2: "fewer than 5",
      B1: "5",
    });
  });

  it("hides further along the table when a hidden total could be added back from its own parts", () => {
    // The thread's buildings: A 3 and B 20, so B is hidden for A; but B is its floors' total, and they are all visible: one of them is hidden too.
    const values = new Map([
      ["thread", 23],
      ["A", 3],
      ["B", 20],
      ["A1", 3],
      ["B1", 12],
      ["B2", 8],
    ]);
    const judged = shownTable(values, [
      { total: "thread", parts: ["A", "B"] },
      { total: "A", parts: ["A1"] },
      { total: "B", parts: ["B1", "B2"] },
    ]);
    expect(Object.fromEntries([...judged].map(([key, shown]) => [key, shown?.shown ?? "left out"]))).toEqual({
      thread: "23",
      A: "fewer than 5",
      B: NOT_SHOWN,
      A1: "left out",
      B1: "12",
      B2: NOT_SHOWN,
    });
  });

  it("refuses a split whose parts do not add up to its total, and a key with no figure", () => {
    expect(() => shownTable(new Map([["t", 5], ["a", 4]]), [{ total: "t", parts: ["a"] }])).toThrow(/not the sum/);
    expect(() => shownTable(new Map([["t", 5]]), [{ total: "t", parts: ["a"] }])).toThrow(/no figure/);
  });

  it("leaves no hidden figure that a reader who knows the rule could work out, in any of a thousand small tables (checked by trying every value)", () => {
    const random = seeded(20261006);
    for (let run = 0; run < 1000; run += 1) {
      const { values, splits } = randomTable(random);
      const judged = shownTable(values, splits);
      // What a reader sees: the figures written, and the splits whose parts are written.
      const live = splits.filter((entry) => entry.parts.every((key) => judged.get(key) !== null));
      for (const [key, shown] of judged) {
        if (shown?.shown !== "fewer than 5") continue;
        const possible = [1, 2, 3, 4].filter((value) => solvable(judged, live, key, value, values));
        expect(possible.length, `${key} in ${JSON.stringify([...values])} ${JSON.stringify(splits)}`).toBeGreaterThan(1);
      }
      // And no figure of 1 to 4 is written.
      for (const shown of judged.values()) if (shown !== null) expect(revealsSmallCount(shown.shown)).toBe(false);
    }
  });
});

describe("a percentage", () => {
  it("is a floor percentage of two shown counts", () => {
    expect(shownPercent(shownCount(7), shownCount(9))).toBe(77);
    expect(shownPercent(shownCount(0), shownCount(9))).toBe(0);
  });

  it("is not shown from a numerator or a denominator of 1 to 4, from a hidden or left-out cell, or from a denominator of 0", () => {
    expect(shownPercent(shownCount(3), shownCount(10))).toBeNull();
    expect(shownPercent(shownCount(3), shownCount(4))).toBeNull();
    expect(shownPercent({ n: null, shown: NOT_SHOWN }, shownCount(10))).toBeNull();
    expect(shownPercent(null, shownCount(10))).toBeNull();
    expect(shownPercent(shownCount(0), shownCount(0))).toBeNull();
  });
});

describe("the last check before writing", () => {
  it("finds a written count of 1 to 4 and nothing else", () => {
    expect(["1", " 4 ", "3"].every(revealsSmallCount)).toBe(true);
    expect(["0", "5", "12", "40", "fewer than 5", NOT_SHOWN, "1.5", ""].some(revealsSmallCount)).toBe(false);
  });
});

// --- an independent check: a reader who tries every value ----------------------------------------------------------------------

/** A small deterministic random source (mulberry32). */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A random table shaped as the export's are: a total split into 1 to 4 parts, each part itself split into 0 to 3 parts (a round, its buildings, their floors),
 * and sometimes a second split of the total (by language and by neighbourhood). Mostly small figures, so the rule has work to do.
 */
function randomTable(random: () => number): { values: Map<string, number>; splits: TableSplit[] } {
  const pick = () => [0, 0, 1, 1, 1, 2, 3, 4, 4, 5, 5, 6, 7, 9, 12, 20][Math.floor(random() * 16)];
  const values = new Map<string, number>([["T", 0]]);
  const splits: TableSplit[] = [];
  const top: string[] = [];
  const parts = 1 + Math.floor(random() * 4);
  for (let p = 0; p < parts; p += 1) {
    const key = `P${p}`;
    top.push(key);
    values.set(key, 0);
    const children = Math.floor(random() * 4);
    if (children === 0) {
      values.set(key, pick());
      continue;
    }
    const keys: string[] = [];
    for (let c = 0; c < children; c += 1) {
      const child = `${key}.${c}`;
      keys.push(child);
      values.set(child, pick());
    }
    values.set(key, keys.reduce((sum, child) => sum + values.get(child)!, 0));
    splits.push({ total: key, parts: keys });
  }
  const total = top.reduce((sum, key) => sum + values.get(key)!, 0);
  values.set("T", total);
  splits.push({ total: "T", parts: top });
  if (random() < 0.4) {
    // A second split of the total into 2 or 3 parts.
    const second = 2 + Math.floor(random() * 2);
    let left = total;
    const keys: string[] = [];
    for (let s = 0; s < second; s += 1) {
      const n = s === second - 1 ? left : Math.floor(random() * (left + 1));
      left -= n;
      keys.push(`S${s}`);
      values.set(`S${s}`, n);
    }
    splits.push({ total: "T", parts: keys });
  }
  return { values, splits };
}

/**
 * Whether some value of every hidden figure, each within what its words say, fits every split a reader sees with `key` at `value`: the sets of values each
 * figure can take, added up from the leaves to the table's top (no ranges, unlike the rule's own working out). A "not shown" is tried from 5 to a little over
 * the true total (another value of a hidden figure moves the others by at most 3, so a solution, if any, is found below that).
 */
function solvable(judged: Map<string, Shown | null>, splits: readonly TableSplit[], key: string, value: number, values: ReadonlyMap<string, number>): boolean {
  const cap = values.get("T")! + 8;
  const domain = (k: string): number[] => {
    const shown = judged.get(k)!;
    if (k === key) return [value];
    if (shown.n !== null) return [shown.n];
    if (shown.shown === "fewer than 5") return [1, 2, 3, 4];
    return Array.from({ length: cap - 4 }, (_, index) => index + 5);
  };
  const possible = (k: string): Set<number> => {
    let set = new Set(domain(k));
    for (const entry of splits.filter((candidate) => candidate.total === k)) {
      let sums = new Set([0]);
      for (const part of entry.parts) {
        const options = possible(part);
        const next = new Set<number>();
        for (const sum of sums) for (const n of options) if (sum + n <= cap) next.add(sum + n);
        sums = next;
      }
      set = new Set([...set].filter((n) => sums.has(n)));
    }
    return set;
  };
  const inSplits = new Set(splits.flatMap((entry) => [entry.total, ...entry.parts]));
  if (!inSplits.has(key)) return value >= 1 && value <= 4;
  const tops = [...inSplits].filter((k) => !splits.some((entry) => entry.parts.includes(k)));
  return tops.every((top) => possible(top).size > 0);
}
