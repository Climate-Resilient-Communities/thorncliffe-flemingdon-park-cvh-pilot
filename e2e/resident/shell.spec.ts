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
