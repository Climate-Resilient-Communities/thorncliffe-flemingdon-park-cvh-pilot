import { describe, expect, it } from "vitest";
import { NOT_SHOWN, isSmall, revealsSmallCount, shownCount, shownPercent, shownSplit } from "./smallNumbers";

// E09's small-number rule as the pilot measures export applies it (S09.05): 1 to 4 hidden, a second cell hidden where a total would reveal one, a percentage
// from a hidden or small figure not shown, zero shown.

const cells = (split: ReturnType<typeof shownSplit<string>>) => split.cells.map((cell) => `${cell.key}=${cell.count.shown}`);

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
    const split = shownSplit([
      { key: "en", n: 40 },
      { key: "ur", n: 3 },
      { key: "ps", n: 9 },
      { key: "tl", n: 0 },
    ]);
    expect(split.total).toEqual({ n: 52, shown: "52" });
    expect(cells(split)).toEqual(["en=40", "ur=fewer than 5", `ps=${NOT_SHOWN}`, "tl=0"]);
    expect(split.cells[2].count.n).toBeNull();
  });

  it("hides nothing more when two cells are 1 to 4: neither can be told from the total", () => {
    const split = shownSplit([
      { key: "en", n: 40 },
      { key: "ur", n: 3 },
      { key: "ps", n: 2 },
    ]);
    expect(cells(split)).toEqual(["en=40", "ur=fewer than 5", "ps=fewer than 5"]);
  });

  it("never hides a zero for another cell, and takes the first of equal cells", () => {
    expect(cells(shownSplit([{ key: "a", n: 0 }, { key: "b", n: 2 }, { key: "c", n: 7 }, { key: "d", n: 7 }]))).toEqual(["a=0", "b=fewer than 5", `c=${NOT_SHOWN}`, "d=7"]);
  });

  it("hides the total itself when it is 1 to 4 (every cell then is too, or 0)", () => {
    const split = shownSplit([
      { key: "TP", n: 3 },
      { key: "FP", n: 0 },
    ]);
    expect(split.total.shown).toBe("fewer than 5");
    expect(cells(split)).toEqual(["TP=fewer than 5", "FP=0"]);
  });

  it("shows an empty split as a total of 0", () => {
    expect(shownSplit([])).toEqual({ total: { n: 0, shown: "0" }, cells: [] });
  });
});

describe("a percentage", () => {
  it("is a floor percentage of two shown counts", () => {
    expect(shownPercent(shownCount(7), shownCount(9))).toBe(77);
    expect(shownPercent(shownCount(0), shownCount(9))).toBe(0);
  });

  it("is not shown from a numerator or a denominator of 1 to 4, from a hidden cell, or from a denominator of 0", () => {
    expect(shownPercent(shownCount(3), shownCount(10))).toBeNull();
    expect(shownPercent(shownCount(3), shownCount(4))).toBeNull();
    expect(shownPercent({ n: null, shown: NOT_SHOWN }, shownCount(10))).toBeNull();
    expect(shownPercent(shownCount(0), shownCount(0))).toBeNull();
  });
});

describe("the last check before writing", () => {
  it("finds a written count of 1 to 4 and nothing else", () => {
    expect(["1", " 4 ", "3"].every(revealsSmallCount)).toBe(true);
    expect(["0", "5", "12", "40", "fewer than 5", NOT_SHOWN, "1.5", ""].some(revealsSmallCount)).toBe(false);
  });
});
