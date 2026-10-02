import { expect, test, type Page } from "@playwright/test";
import { LANGUAGES, openResident } from "./helpers";

// S02.02: a string that fell back to English ("[EN] ...") is an isolated left-to-right English run, so a
// right-to-left page does not reorder it ("Nothing is happening [EN] / .right now") and a screen reader switches voice.

type Glyph = { char: string; left: number; right: number; top: number };

/** Every character of an element's text with its box, in logical (text) order. */
async function glyphs(page: Page, selector: string): Promise<Glyph[]> {
  return page.evaluate((css) => {
    const element = document.querySelector(css)!;
    const found: { char: string; left: number; right: number; top: number }[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const range = document.createRange();
      for (let index = 0; index < node.length; index += 1) {
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const box = range.getClientRects()[0];
        if (box) found.push({ char: node.data[index], left: box.left, right: box.right, top: box.top });
      }
    }
    return found;
  }, selector);
}

/** True when the characters read left to right: each is on the same line to the right of the one before, or on a later line. */
function readsLeftToRight(list: Glyph[]) {
  return list.every((glyph, index) => {
    if (index === 0) return true;
    const before = list[index - 1];
    return glyph.top > before.top + 2 || (Math.abs(glyph.top - before.top) <= 2 && glyph.left >= before.left - 0.5);
  });
}

for (const code of ["ur", "ps", "prs"]) {
  test.describe(`${code}: English fallback text`, () => {
    test("is an English left-to-right run, and its full stop is at the visual end", async ({ page }) => {
      await openResident(page, `/${code}`, 390);

      for (const selector of ["main h1", "main p"]) {
        const run = page.locator(`${selector} > bdi`);
        await expect(run, selector).toHaveCount(1);
        await expect(run, selector).toHaveAttribute("lang", "en");
        await expect(run, selector).toHaveAttribute("dir", "ltr");

        const text = await run.textContent();
        expect(text, selector).toMatch(/^\[EN\] .*\.$/);

        const list = await glyphs(page, `${selector} > bdi`);
        expect(list.map(({ char }) => char).join(""), selector).toBe(text);
        expect(readsLeftToRight(list), `${selector} reads left to right`).toBe(true);

        // The full stop is the last character, on the last line, further right than every other character on it.
        const last = list.at(-1)!;
        expect(last.char).toBe(".");
        const lastLine = list.filter((glyph) => Math.abs(glyph.top - last.top) <= 2);
        expect(Math.max(...lastLine.map((glyph) => glyph.right)), `${selector}: the full stop ends the last line`).toBeCloseTo(last.right, 0);
        // And the marker starts the first line, at its left.
        const first = list[0];
        expect(first.char).toBe("[");
        const firstLine = list.filter((glyph) => Math.abs(glyph.top - first.top) <= 2);
        expect(Math.min(...firstLine.map((glyph) => glyph.left)), `${selector}: the marker starts the first line`).toBeCloseTo(first.left, 0);
      }
    });
  });
}

test("the English heading of a right-to-left page sits at the start (right) edge, the text inside it reading left to right", async ({ page }) => {
  await openResident(page, "/ur", 390);
  const { heading, main } = await page.evaluate(() => {
    const read = (element: Element) => element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("main h1 > bdi")!);
    return { heading: range.getBoundingClientRect().toJSON(), main: read(document.querySelector("main")!).toJSON() };
  });

  // text-align: start in a right-to-left paragraph: the run's right edge is the content edge, one gutter in from the main's.
  expect(main.right - heading.right).toBeGreaterThan(0);
  expect(main.right - heading.right).toBeLessThan(30);
  expect(heading.left - main.left).toBeGreaterThan(10);
});

for (const language of LANGUAGES) {
  test(`${language.code}: every string that fell back to English is in an element with lang="en" dir="ltr"`, async ({ page }) => {
    await openResident(page, `/${language.code}`, 390);

    const strays = await page.evaluate(() => {
      const bad: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim() ?? "";
        if (!text.startsWith("[EN]")) continue;
        const run = node.parentElement?.closest("[lang]");
        if (run?.getAttribute("lang") !== "en" || run.getAttribute("dir") !== "ltr") bad.push(text);
      }
      return bad;
    });

    expect(strays).toEqual([]);
  });
}
