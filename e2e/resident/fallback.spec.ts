import { expect, test, type Page } from "@playwright/test";
import { newServer, stubDirectory } from "./directory-fixture";
import { catalogText, FALLBACK, isFallback, LANGUAGES, openResident, waitForFonts } from "./helpers";

// S02.02: a string that fell back to English ("[EN] ...") is English with lang="en" dir="ltr". When it is the whole
// text of a heading or paragraph, those attributes sit on that element itself, so a right-to-left page does not reorder
// it ("Nothing is happening [EN] / .right now"), its lines start at the left and wrap normally, and a screen reader
// switches voice. (Inside otherwise-translated text the run is an inline <bdi>: see ResidentText.)
//
// These tests need a resident page that still shows English fallback text in a right-to-left language. They use the
// directory (S02.06), whose own wording is not translated yet, and read from the catalog which of its blocks still fall
// back, so translating one leaves the others tested. When none of them does any more, the tests fail and say so: point
// them at another page with a string its catalog still marks [EN] (a unit test with a stub catalog cannot measure layout).

/** The resident page with English fallback text, and the blocks on it that are one catalog string each. */
const FALLBACK_PAGE = "directory";
const BLOCKS = [
  { selector: "main h1", key: "directory.title" },
  { selector: "main h1 + p", key: "directory.lead" },
] as const;

/** The blocks of FALLBACK_PAGE whose string is still English fallback in `code`, with that string. Fails when there are none. */
function fallbackBlocks(code: string) {
  const found = BLOCKS.map((block) => ({ ...block, text: catalogText(code, block.key) })).filter(({ text }) => isFallback(text));
  if (found.length === 0) {
    throw new Error(
      `No English fallback left to test: ${BLOCKS.map(({ key }) => key).join(", ")} are translated in ${code}. ` +
        `Point fallback.spec.ts at a resident page whose ${code} catalog strings still start with "${FALLBACK}".`,
    );
  }
  return found;
}

/** Opens FALLBACK_PAGE in `code` with the directory's release answered, and waits until its list and fonts are drawn. */
async function openFallbackPage(page: Page, code: string) {
  await stubDirectory(page, newServer(7));
  await openResident(page, `/${code}/${FALLBACK_PAGE}`, 390);
  await expect(page.getByTestId("directory-list")).toBeVisible();
  await waitForFonts(page);
}

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
    test("is a left-to-right English block, and its full stop is at the visual end", async ({ page }) => {
      const blocks = fallbackBlocks(code);
      expect(
        blocks.some(({ text }) => text.endsWith(".")),
        `one of the fallback blocks tested (${blocks.map(({ key }) => key).join(", ")}) must end in a full stop`,
      ).toBe(true);
      await openFallbackPage(page, code);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

      for (const { selector, key, text } of blocks) {
        const run = page.locator(`${selector}[lang=en][dir=ltr]`);
        await expect(run, key).toHaveCount(1);
        // The block itself carries the language and direction; there is no inline run inside it.
        await expect(run.locator("bdi"), key).toHaveCount(0);
        await expect(run, key).toHaveText(text);

        const list = await glyphs(page, `${selector}[lang=en][dir=ltr]`);
        expect(list.map(({ char }) => char).join(""), key).toBe(text);
        expect(readsLeftToRight(list), `${key} reads left to right`).toBe(true);

        // The last character (a full stop where the string has one) is on the last line, further right than every other character on it.
        const last = list.at(-1)!;
        expect(last.char, key).toBe(text.at(-1));
        const lastLine = list.filter((glyph) => Math.abs(glyph.top - last.top) <= 2);
        expect(Math.max(...lastLine.map((glyph) => glyph.right)), `${key}: the last character ends the last line`).toBeCloseTo(last.right, 0);
        // And the marker starts the first line, at its left.
        const first = list[0];
        expect(first.char).toBe("[");
        const firstLine = list.filter((glyph) => Math.abs(glyph.top - first.top) <= 2);
        expect(Math.min(...firstLine.map((glyph) => glyph.left)), `${key}: the marker starts the first line`).toBeCloseTo(first.left, 0);
      }
    });

    test("a date in a string that fell back to English is written the English way, in the English block", async ({ page }) => {
      const template = catalogText(code, "directory.lastConfirmed");
      expect(isFallback(template), `directory.lastConfirmed is translated in ${code}: point this test at a dated string the ${code} catalog still marks [EN]`).toBe(true);
      await openFallbackPage(page, code);

      // The sample food bank was last confirmed on 2026-09-30.
      const confirmed = page.getByTestId("provider-P101").getByTestId("last-confirmed");
      await expect(confirmed).toHaveText(template.replace("{date}", "September 30, 2026"));
      await expect(confirmed).toHaveAttribute("lang", "en");
      await expect(confirmed).toHaveAttribute("dir", "ltr");
    });
  });
}

test("the English block of a right-to-left page is a left-to-right block: its text starts at the left gutter", async ({ page }) => {
  const [{ selector, key }] = fallbackBlocks("ur");
  await openFallbackPage(page, "ur");
  const { block, main } = await page.evaluate((css) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(`${css}[lang=en][dir=ltr]`)!);
    return { block: range.getBoundingClientRect().toJSON(), main: document.querySelector("main")!.getBoundingClientRect().toJSON() };
  }, selector);

  // text-align: start in a left-to-right block: the text's left edge is the content edge, one gutter in from the main's.
  expect(block.left - main.left, key).toBeGreaterThan(10);
  expect(block.left - main.left, key).toBeLessThan(30);
});

for (const language of LANGUAGES) {
  test(`${language.code}: every string that fell back to English is in an element with lang="en" dir="ltr"`, async ({ page }) => {
    await stubDirectory(page, newServer(7));
    // The home screen, and a page that still has English fallback text in every language but English.
    for (const path of [`/${language.code}`, `/${language.code}/${FALLBACK_PAGE}`]) {
      await openResident(page, path, 390);
      if (path.endsWith(FALLBACK_PAGE)) await expect(page.getByTestId("directory-list"), path).toBeVisible();

      const { strays, runs } = await page.evaluate(() => {
        const bad: string[] = [];
        let count = 0;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent?.trim() ?? "";
          if (!text.startsWith("[EN]")) continue;
          count += 1;
          const run = node.parentElement?.closest("[lang]");
          if (run?.getAttribute("lang") !== "en" || run.getAttribute("dir") !== "ltr") bad.push(text);
        }
        return { strays: bad, runs: count };
      });

      expect(strays, path).toEqual([]);
      if (path.endsWith(FALLBACK_PAGE) && BLOCKS.some(({ key }) => isFallback(catalogText(language.code, key)))) {
        expect(runs, `${path} shows its English fallback text`).toBeGreaterThan(0);
      }
    }
  });
}
