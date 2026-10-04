import { expect, test, type Page } from "@playwright/test";
import { FALLBACK_KEYS, FALLBACK_URL } from "./fallback-server";
import { catalogText, FALLBACK, LANGUAGES, openResident, waitForFonts } from "./helpers";

// S02.02: a string that fell back to English ("[EN] ...") is English with lang="en" dir="ltr". When it is the whole
// text of a heading or paragraph, those attributes sit on that element itself, so a right-to-left page does not reorder
// it ("Nothing is happening [EN] / .right now"), its lines start at the left and wrap normally, and a screen reader
// switches voice. (Inside otherwise-translated text the run is an inline <bdi>: see ResidentText.)
//
// These tests need a resident page that shows English fallback text in a right-to-left language, and must not depend on
// which strings happen to be untranslated. So they run against the second server of playwright.resident.config.ts: the
// same production build, started with CVH_FAKE_UNTRANSLATED_KEYS (src/i18n/untranslated.ts, local development only),
// which shows FALLBACK_KEYS as English behind the marker in every language but English, exactly as a key a catalog
// lacks. The page is the essential numbers (S02.10): rendered on request, so the seam reaches it, with a heading and a
// lead that are one catalog string each and a dated line. If the server stops showing them as fallback, every test here
// fails and says so. (Unit tests with stub catalogs cover the components: resident-text.test.tsx, isolated.test.tsx.)

/** The resident page with English fallback text, on the fallback server, and the blocks on it that are one catalog string each. */
const FALLBACK_PAGE = "ready/numbers";
const BLOCKS = [
  { selector: "main h1", key: "R31.title" },
  { selector: "main h1 + p", key: "R31.lead" },
] as const;
const DATED = { testId: "numbers-checked", key: "R31.checked" } as const;

for (const key of [...BLOCKS.map((block) => block.key), DATED.key]) {
  if (!(FALLBACK_KEYS as readonly string[]).includes(key)) throw new Error(`${key} is not one of the fallback server's FALLBACK_KEYS (fallback-server.ts)`);
}

/** What the fallback server shows for a key in every language but English: the English string behind the marker. */
const fallbackText = (key: string) => FALLBACK + catalogText("en", key);

/** The blocks of FALLBACK_PAGE, with the English fallback text each shows. */
const fallbackBlocks = () => BLOCKS.map((block) => ({ ...block, text: fallbackText(block.key) }));

/** Opens FALLBACK_PAGE in `code` on the fallback server and waits until its fonts are drawn; fails loudly if it shows no fallback. */
async function openFallbackPage(page: Page, code: string) {
  await openResident(page, `${FALLBACK_URL}/${code}/${FALLBACK_PAGE}`, 390);
  await waitForFonts(page);
  for (const { selector, key, text } of fallbackBlocks()) {
    await expect(
      page.locator(selector),
      `${key} must show as English fallback on the server started with CVH_FAKE_UNTRANSLATED_KEYS (${FALLBACK_URL}); if it does not, the test seam in src/i18n/untranslated.ts stopped working`,
    ).toHaveText(text);
  }
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
      const blocks = fallbackBlocks();
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
      const template = fallbackText(DATED.key);
      await openFallbackPage(page, code);

      // The sample numbers were last updated on 2026-09-30 (fixtures/guides.json).
      const checked = page.getByTestId(DATED.testId);
      await expect(checked).toHaveText(template.replace("{date}", "September 30, 2026"));
      await expect(checked).toHaveAttribute("lang", "en");
      await expect(checked).toHaveAttribute("dir", "ltr");
    });
  });
}

test("the English block of a right-to-left page is a left-to-right block: its text starts at the left gutter", async ({ page }) => {
  const [{ selector, key }] = fallbackBlocks();
  await openFallbackPage(page, "ur");
  // The block is drawn after the page loads (a failed attempt in CI had no node to select yet).
  await expect(page.locator(`${selector}[lang=en][dir=ltr]`)).toBeVisible();
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
    // The home screen as it is, and the page the fallback server shows English fallback text on in every language but English.
    for (const path of [`/${language.code}`, `${FALLBACK_URL}/${language.code}/${FALLBACK_PAGE}`]) {
      await openResident(page, path, 390);

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
      if (path.startsWith(FALLBACK_URL)) {
        // English has no fallback; every other language shows at least the fallback server's keys.
        if (language.code === "en") expect(runs, `${path} has no English fallback text`).toBe(0);
        else expect(runs, `${path} shows its English fallback text (CVH_FAKE_UNTRANSLATED_KEYS)`).toBeGreaterThanOrEqual(BLOCKS.length + 1);
      }
    }
  });
}
