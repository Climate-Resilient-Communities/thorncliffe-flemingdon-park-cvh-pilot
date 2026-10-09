import { expect, test, type Page } from "@playwright/test";
import { HEIGHTS, LANGUAGES, WIDTHS, expectBaseline, openResident, shellBoxes } from "./helpers";

// S02.02: the resident shell in every launch language at 320, 390 and 768 px.

/** Opens home and waits until its feed has answered, so the screen inside the shell is the settled one (S02.11). */
async function openSettledHome(page: Page, path: string, width: number) {
  await openResident(page, path, width);
  await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "ready");
}

for (const language of LANGUAGES) {
  test.describe(`${language.code}`, () => {
    test(`sets <html lang="${language.bcp47}" dir="${language.dir}">`, async ({ page }) => {
      await openResident(page, `/${language.code}`, 390);

      const html = page.locator("html");
      await expect(html).toHaveAttribute("lang", language.bcp47);
      await expect(html).toHaveAttribute("dir", language.dir);
    });

    for (const width of [320, 390] as const) {
      test(`keeps every navigation label inside its item at ${width}px: four equal columns, nothing wider than its item`, async ({ page }) => {
        await openResident(page, `/${language.code}`, width);

        const measured = await page.evaluate(() => {
          const nav = document.querySelector('[data-testid="shell-nav"]')!;
          const navBox = nav.getBoundingClientRect();
          return [...nav.querySelectorAll("a")].map((item) => {
            const box = item.getBoundingClientRect();
            const label = item.querySelector(".shell-nav__label")!;
            const range = document.createRange();
            range.selectNodeContents(label);
            const text = range.getBoundingClientRect();
            return {
              width: box.width,
              left: box.left - navBox.left,
              overflow: item.scrollWidth - item.clientWidth,
              textStart: text.left - box.left,
              textEnd: box.right - text.right,
            };
          });
        });

        expect(measured).toHaveLength(4);
        for (const item of measured) {
          expect(item.width).toBeCloseTo(width / 4, 0);
          expect(item.overflow).toBeLessThanOrEqual(0);
          expect(item.textStart).toBeGreaterThanOrEqual(-0.5);
          expect(item.textEnd).toBeGreaterThanOrEqual(-0.5);
        }
      });
    }

    for (const width of WIDTHS) {
      test(`has no horizontal scrolling at ${width}px and matches its baseline screenshot`, async ({ page }) => {
        await openSettledHome(page, `/${language.code}`, width);

        const overflow = await page.evaluate(() => {
          const main = document.querySelector("main")!;
          return {
            page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            body: document.body.scrollWidth - document.documentElement.clientWidth,
            main: main.scrollWidth - main.clientWidth,
          };
        });
        expect(overflow).toEqual({ page: 0, body: 0, main: 0 });

        await expectBaseline(page, `shell-${language.code}-${width}.png`);
      });
    }
  });
}

// A balanced bottom navigation: four items of one width, each one's icon centred in it (±1 px) above its centred label, every icon on one
// line and every label below it, items at least the tap size (56 px in basic mode). In a left-to-right and a right-to-left language, with
// standard text, large text (display settings) and basic mode (which brings large text with it).
const DISPLAY_MODES = [
  { name: "standard text", choices: {}, basic: false },
  { name: "large text", choices: { textSize: "large" }, basic: false },
  { name: "basic mode", choices: { basic: true }, basic: true },
] as const;

for (const code of ["en", "ur"] as const) {
  for (const mode of DISPLAY_MODES) {
    for (const width of WIDTHS) {
      test(`${code}, ${mode.name}, ${width}px: the bottom navigation's items are equal and each icon and label is centred in its item`, async ({ page }) => {
        await page.addInitScript(([key, value]) => localStorage.setItem(key, value), ["cvh.choices", JSON.stringify({ v: 1, welcomed: true, ...mode.choices })] as const);
        await openResident(page, `/${code}`, width);
        expect(await page.locator("html").getAttribute("data-basic")).toBe(mode.basic ? "true" : null);

        const items = await page.evaluate(() =>
          [...document.querySelectorAll('[data-testid="shell-nav"] a')].map((item) => {
            const box = item.getBoundingClientRect();
            const middle = box.left + box.width / 2;
            const icon = item.querySelector(".shell-ico")!.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(item.querySelector(".shell-nav__label")!);
            const text = range.getBoundingClientRect();
            return {
              width: box.width,
              height: box.height,
              iconOffset: icon.left + icon.width / 2 - middle,
              textOffset: text.left + text.width / 2 - middle,
              iconTop: icon.top,
              iconBottom: icon.bottom,
              textTop: text.top,
            };
          }),
        );

        expect(items).toHaveLength(4);
        const tap = mode.basic ? 56 : 44;
        for (const [index, item] of items.entries()) {
          expect(Math.abs(item.width - items[0].width), `item ${index}: width`).toBeLessThanOrEqual(1);
          expect(Math.abs(item.iconOffset), `item ${index}: icon centred`).toBeLessThanOrEqual(1);
          expect(Math.abs(item.textOffset), `item ${index}: label centred`).toBeLessThanOrEqual(1);
          expect(Math.abs(item.iconTop - items[0].iconTop), `item ${index}: icons on one line`).toBeLessThanOrEqual(1);
          expect(item.textTop, `item ${index}: label below its icon`).toBeGreaterThanOrEqual(item.iconBottom);
          expect(Math.min(item.width, item.height), `item ${index}: tap size`).toBeGreaterThanOrEqual(tap);
        }
      });
    }
  }
}

// How the bottom navigation's labels wrap (design owner, 2026-10-09): at the nav's own type size (--type-nav-size: 14px, 16px with large
// text or in basic mode), a label stays inside its item, so it never overflows its column or overlaps a neighbour, and it wraps between
// words. A word breaks inside only when that word alone, unbroken, is wider than the label's column. Words are the language's own
// (Intl.Segmenter), so a break between two Chinese words is a break between words; lines are found from the boxes of the label's
// graphemes. Every language, at 320 and 390 px, with standard text, large text and basic mode. The breaks inside a word that remain are
// recorded as annotations of the test ("inside a word"), so a run lists them.
type Box = { left: number; right: number; top: number; bottom: number };
type LabelLayout = {
  label: string;
  fontSize: number;
  item: Box;
  text: Box;
  column: number;
  breaks: { insideWord: string | null; wordWidth: number }[];
};

async function navLabelLayout(page: Page): Promise<LabelLayout[]> {
  return page.evaluate(() => {
    const lang = document.documentElement.lang;
    const words = new Intl.Segmenter(lang, { granularity: "word" });
    const graphemes = new Intl.Segmenter(lang, { granularity: "grapheme" });
    const box = (rect: DOMRect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
    return [...document.querySelectorAll('[data-testid="shell-nav"] a')].map((item) => {
      const label = item.querySelector<HTMLElement>(".shell-nav__label")!;
      const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
      if (nodes.length !== 1) throw new Error(`a navigation label is one text node, not ${nodes.length}: ${label.textContent}`);
      const node = nodes[0];
      const text = node.data;
      const rectOf = (start: number, end: number) => {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        return range.getBoundingClientRect();
      };
      // The start of every line after the first: a grapheme whose box is below the one before it.
      const lineStarts: number[] = [];
      let previous: DOMRect | null = null;
      for (const { index, segment } of graphemes.segment(text)) {
        if (/^\s+$/.test(segment)) continue;
        const current = rectOf(index, index + segment.length);
        if (previous && current.top >= previous.bottom - current.height / 2) lineStarts.push(index);
        previous = current;
      }
      // The width of a broken word set on one line in the label's own font.
      const probe = document.createElement("span");
      probe.style.whiteSpace = "nowrap";
      probe.style.position = "absolute";
      label.append(probe);
      const segments = [...words.segment(text)];
      const breaks = lineStarts.map((at) => {
        const word = segments.find(({ index, segment }) => index < at && at < index + segment.length);
        if (!word) return { insideWord: null, wordWidth: 0 };
        probe.textContent = word.segment;
        return { insideWord: word.segment, wordWidth: probe.getBoundingClientRect().width };
      });
      probe.remove();
      const style = getComputedStyle(label);
      const whole = document.createRange();
      whole.selectNodeContents(label);
      return {
        label: text,
        fontSize: parseFloat(style.fontSize),
        item: box(item.getBoundingClientRect()),
        text: box(whole.getBoundingClientRect()),
        column: label.getBoundingClientRect().width,
        breaks,
      };
    });
  });
}

for (const language of LANGUAGES) {
  for (const mode of DISPLAY_MODES) {
    test(`${language.code}, ${mode.name}: the navigation labels stay in their columns at the nav size, and break inside a word only when it is wider than the column`, async ({ page }) => {
      await page.addInitScript(([key, value]) => localStorage.setItem(key, value), ["cvh.choices", JSON.stringify({ v: 1, welcomed: true, ...mode.choices })] as const);
      await openResident(page, `/${language.code}`, 390);
      expect(await page.locator("html").getAttribute("data-basic")).toBe(mode.basic ? "true" : null);
      const navSize = mode.name === "standard text" ? 14 : 16;
      for (const width of [320, 390] as const) {
        await page.setViewportSize({ width, height: HEIGHTS[width] });
        const labels = await navLabelLayout(page);
        expect(labels).toHaveLength(4);
        for (const [index, label] of labels.entries()) {
          const where = `${width}px, "${label.label}"`;
          expect(label.fontSize, `${where}: font size`).toBeGreaterThanOrEqual(navSize);
          expect(label.text.left, `${where}: inside its item (start)`).toBeGreaterThanOrEqual(label.item.left - 0.5);
          expect(label.text.right, `${where}: inside its item (end)`).toBeLessThanOrEqual(label.item.right + 0.5);
          expect(label.text.bottom, `${where}: inside its item (bottom)`).toBeLessThanOrEqual(label.item.bottom + 0.5);
          const next = labels[index + 1];
          if (next) {
            const apart = Math.max(next.text.left - label.text.right, label.text.left - next.text.right);
            expect(apart, `${where}: apart from "${next.label}"`).toBeGreaterThanOrEqual(0);
          }
          for (const { insideWord, wordWidth } of label.breaks) {
            if (insideWord === null) continue;
            expect(wordWidth, `${where}: "${insideWord}" is broken inside, so alone it is wider than its column (${label.column.toFixed(1)}px)`).toBeGreaterThan(label.column);
            test.info().annotations.push({ type: "inside a word", description: `${language.code}, ${mode.name}, ${width}px: "${insideWord}" (${wordWidth.toFixed(1)}px in a ${label.column.toFixed(1)}px column)` });
          }
        }
      }
    });
  }
}

test("every right-to-left page sets dir=rtl, and no other does", async ({ page }) => {
  const dirs: Record<string, string | null> = {};
  for (const { code } of LANGUAGES) {
    await page.goto(`/${code}`);
    dirs[code] = await page.locator("html").getAttribute("dir");
  }

  expect(Object.keys(dirs).filter((code) => dirs[code] === "rtl")).toEqual(["ur", "ps", "prs"]);
});

// Mirroring: an element's left edge in a right-to-left language is the viewport width minus its right edge in
// English (within 1px). The elements are the shell parts and the screen's body, heading and text.
for (const rtl of ["ur", "ps", "prs"]) {
  for (const width of WIDTHS) {
    test(`${rtl} is the mirror image of en at ${width}px (±1px)`, async ({ page }) => {
      await openSettledHome(page, "/en", width);
      const english = await shellBoxes(page);
      await openSettledHome(page, `/${rtl}`, width);
      const mirrored = await shellBoxes(page);

      expect(Object.keys(mirrored)).toEqual(Object.keys(english));
      for (const part of Object.keys(english)) {
        // The logo is anchored at the inline start and shrinks (object-fit: contain) to leave the language and Aa buttons their room
        // at narrow widths, so its width follows the length of the language button's label: its start edge is the one that mirrors.
        if (part === "shell-logo") {
          expect(Math.abs(mirrored[part].right - (width - english[part].left)), `${part}: start edge`).toBeLessThanOrEqual(1);
          continue;
        }
        expect(Math.abs(mirrored[part].left - (width - english[part].right)), `${part}: left edge`).toBeLessThanOrEqual(1);
        // Only the language button is as wide as its text, which differs by language.
        if (part !== "shell-lang-button") {
          expect(Math.abs(mirrored[part].width - english[part].width), `${part}: width`).toBeLessThanOrEqual(1);
        }
      }
    });
  }
}

// Light and navy: nothing moves when only the colours change. The pilot ships no theme switch (G9), so the
// navy theme is applied here by the attribute its tokens are declared under.
for (const code of ["en", "ur"]) {
  test(`${code} at 390px: every element's box is the same in the light and navy themes`, async ({ page }) => {
    await openSettledHome(page, `/${code}`, 390);
    const boxes = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("body *:not(next-route-announcer)")].map((element) => {
          const r = element.getBoundingClientRect();
          return [element.tagName, r.left, r.top, r.width, r.height];
        }),
      );
    const background = () => page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="shell"]')!).backgroundColor);

    const light = await boxes();
    const lightBackground = await background();
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    const navy = await boxes();
    const navyBackground = await background();

    expect(light.length).toBeGreaterThan(30);
    expect(navyBackground).not.toBe(lightBackground);
    expect(navy).toEqual(light);
  });
}

test("the shell stays inside the viewport height: the main scrolls, not the page", async ({ page }) => {
  await openResident(page, "/en", 390);

  const { scrolls, frame } = await page.evaluate(() => ({
    scrolls: document.documentElement.scrollHeight <= document.documentElement.clientHeight,
    frame: document.querySelector('[data-testid="shell"]')!.getBoundingClientRect().height,
  }));
  expect(scrolls).toBe(true);
  expect(frame).toBe(HEIGHTS[390]);
});
