import { expect, test, type Page } from "@playwright/test";
import { composerScreen, type ComposerMode, type ComposerScreen, type Text } from "../../src/app/staff/alerts/composer/view";
import { logScreen } from "../../src/app/staff/alerts/log/view";
import type { EntryState } from "../../src/modules/alerting";
import type { BuildingFloorPlan } from "../../src/modules/places";
import { box, checkHubShellBoundaries, checkHubTwoColumnBoundaries, computed, expectNoHorizontalOverflow, hubPage, setContentWidth, tokenPx, type HubLanguage } from "../helpers/hub-layout-boundaries";
import { REAL_TEXTS, hubBrand, longestTexts } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { longestLabels } from "../helpers/strings";

// S04.05: the acknowledgement composer (O-12) and the alert composer (O-02) at content widths of 799 and 800 px (viewports of 1087 and
// 1088 px with the side navigation) and at viewports of 699 and 700 px, in `en` and `ur` with the longest translated labels of the
// language in every place the screens show text, and "Log a disruption" (O-11) with the same widths. Below 800 px of content width a
// composer is one column, the main content first and the aside after it; from 800 px two columns with the page's approved gap; the actions
// stay in the sticky actions region at the block end in both; and nothing overflows horizontally. The checks are the shared boundary
// helpers of S01.16 (e2e/helpers/hub-layout-boundaries.ts), run on the app's own ComposerBody and LogBody inside the real Hub shell.
const brand = hubBrand();

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ENTRY = "01900000-0000-7000-8000-00000000e177";
const OTHER = "01900000-0000-7000-8000-00000000e178";
const KEY = "0f0e0d0c-0b0a-4908-8706-050403020100";
const NOW = new Date("2026-10-04T14:00:00.000Z");

const floorId = (rsn: string, index: number) => `01900000-0000-7000-8000-${rsn.padStart(8, "0")}${String(index).padStart(4, "0")}`;

/** Buildings with many floors, one whose address is a single unbreakable word (the longest word of the language, repeated). */
function plansFor(lang: string): BuildingFloorPlan[] {
  const plan = (rsn: string, address: string, floors: number, nb: "TP" | "FP"): BuildingFloorPlan => ({
    rsn,
    address,
    neighbourhoodId: nb,
    neighbourhoodName: nb === "TP" ? "Thorncliffe Park" : "Flemingdon Park",
    floors: ["G", ...Array.from({ length: floors }, (_, index) => String(index + 1))].map((label, index) => ({ id: floorId(rsn, index), label, sortOrder: index })),
  });
  return [plan("4154146", "4 Milepost Pl", 12, "TP"), plan("4154159", longestLabels(lang).unbreakable, 9, "TP"), plan("4154763", longestLabels(lang).sentences[0], 4, "FP")];
}

/** Every text of the screens replaced by one of the language's longest labels (its longest sentences, words and one unbreakable token). */
function longestText(lang: string): Text {
  const { sentences, words, unbreakable } = longestLabels(lang);
  const pool = [...sentences, ...words, unbreakable, ...sentences.map((sentence) => `${sentence} ${sentence}`)];
  return (key) => pool[[...key].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 9973, 7) % pool.length];
}

const FROZEN: EntryState["translations"] = [
  { lang: "fr", status: "translated", machine: true },
  { lang: "ur", status: "fallback_en", machine: false },
  { lang: "ps", status: "fallback_en", machine: false },
  { lang: "zh-Hant", status: "script_converted", machine: true },
];

function stateOf(options: { kind?: "ack" | "update"; entry?: Record<string, unknown>; attempt?: Record<string, unknown> | null; translations?: EntryState["translations"]; text?: string }): EntryState {
  const types = ["power", "elevator"];
  return {
    thread: { id: ALERT, slug: "abcd2345", isDrill: false, reportedAt: new Date("2026-10-04T13:30:00.000Z"), status: "open" },
    entry: {
      id: ENTRY,
      alertId: ALERT,
      kind: options.kind ?? "ack",
      status: "draft",
      authorId: "01900000-0000-7000-8000-0000000000c1",
      editorIds: [],
      content: {
        text: options.text ?? "The elevator at 4 Milepost Pl is out of service. We are finding out more. More information to come.",
        types,
        audience: {
          scope: "buildings",
          buildings: [
            { rsn: "4154146", floors: [floorId("4154146", 3), floorId("4154146", 4), floorId("4154146", 5)] },
            { rsn: "4154159", floors: null },
          ],
          groups: ["families", "seniors"],
          types,
        },
        phase: "problem",
        validUntil: new Date("2026-10-05T14:00:00.000Z"),
      },
      version: 0,
      contentHash: null,
      submittedAt: null,
      returnedFor: null,
      returnedNote: null,
      approvedBy: null,
      approvedAt: null,
      webPublishedAt: null,
      possibleDuplicateOf: null,
      ...options.entry,
    } as EntryState["entry"],
    attempt:
      options.attempt === undefined || options.attempt === null
        ? null
        : ({ key: KEY, kind: "submit", state: "running", outcome: null, startedAt: NOW, finishedAt: null, budgetMs: 35000, progress: {}, resultVersion: null, resultHash: null, ...options.attempt } as NonNullable<EntryState["attempt"]>),
    translations: options.translations ?? [],
  };
}

function screenOf(which: (typeof PAGES)[number], lang: string, text?: Text): ComposerScreen {
  const { sentences, unbreakable } = longestLabels(lang);
  return composerScreen({
    mode: which.mode,
    state: which.state(),
    plans: plansFor(lang),
    preview: which.preview ? { sms: { body: `${sentences[0]}\n${unbreakable}\n${sentences[1] ?? sentences[0]}`, encoding: "ucs2", segments: 4 }, nineOneOneFirst: true } : null,
    saved: false,
    now: NOW,
    ...(text ? { text } : {}),
  });
}

const PAGES = [
  { name: "O-12 the acknowledgement composer, a draft", mode: "ack" as ComposerMode, state: () => stateOf({}), preview: true, actions: ["save-draft", "submit-button"] },
  { name: "O-02 the alert composer, a draft", mode: "alert" as ComposerMode, state: () => stateOf({ kind: "update" }), preview: true, actions: ["save-draft", "submit-button"] },
  {
    name: "O-12 while a submit runs",
    mode: "ack" as ComposerMode,
    state: () => stateOf({ attempt: { state: "running", progress: { fr: "translated", ur: "fallback_en", zh: "translated" } } }),
    preview: true,
    actions: ["save-draft", "submit-button"],
  },
  {
    name: "O-12 submitted, with languages that fell back",
    mode: "ack" as ComposerMode,
    state: () => stateOf({ entry: { status: "pending_approval", version: 2, contentHash: "d".repeat(64), possibleDuplicateOf: OTHER }, translations: FROZEN, attempt: { state: "committed", resultVersion: 2, finishedAt: NOW } }),
    preview: false,
    actions: ["pull-back", "retry-translation"],
  },
] as const;

type Props = Parameters<typeof mount<"ComposerFixture">>[2];

/**
 * `longest`: the longest labels of the language in the shell and in the screen. `stress`: the real shell (its top bar is as tall as
 * the real one) with the longest labels in the screen. `real`: the app's own English words.
 */
type Words = "longest" | "stress" | "real";
const open = (page: Page, which: (typeof PAGES)[number], lang: HubLanguage, words: Words = "longest") =>
  mount(
    page,
    "ComposerFixture",
    { texts: words === "longest" ? longestTexts(lang) : REAL_TEXTS, brand, screen: screenOf(which, lang, words === "real" ? undefined : longestText(lang)) } satisfies Props,
    { lang },
  );

/** Visible controls smaller than the tap rule: a link or a button, a field, and for a checkbox or a radio the label that is its target. */
async function smallTargets(page: Page) {
  return page.evaluate(() => {
    const minimum = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tap-current"));
    const target = (element: HTMLElement) => (element.matches('input[type="checkbox"], input[type="radio"]') ? (element.closest<HTMLElement>("label") ?? element) : element);
    return [...document.querySelectorAll<HTMLElement>("a[href], button, input:not([type=hidden]), select, textarea")]
      .filter((element) => element.checkVisibility())
      .map(target)
      .filter((element) => {
        const { width, height } = element.getBoundingClientRect();
        return width < minimum || height < minimum;
      })
      .map((element) => element.outerHTML.slice(0, 80));
  });
}

const region = (page: Page) => page.locator(".layout-screen__actions");

for (const which of PAGES) {
  test.describe(which.name, () => {
    test("is one column below 800 px of content width and two from 800 px, in en and ur with the longest labels, with no horizontal overflow", async ({ page }) => {
      await checkHubTwoColumnBoundaries(page, { open: (lang) => open(page, which, lang) });
    });

    test("keeps the shell's breakpoint at viewports of 699 and 700 px, in en and ur, with no horizontal overflow", async ({ page }) => {
      await checkHubShellBoundaries(page, { open: (lang) => open(page, which, lang) });
    });

    test("reads the main content first and the aside after it, in en and ur", async ({ page }) => {
      for (const lang of ["en", "ur"] as const) {
        await page.setViewportSize({ width: 390, height: 844 });
        await open(page, which, lang);
        const grid = hubPage(page).locator(".layout-grid[data-two-column]");
        await expect(grid.locator(":scope > *")).toHaveCount(2);
        await expect(grid.locator(":scope > *").nth(1)).toHaveAttribute("data-testid", "composer-aside");
        await expectNoHorizontalOverflow(page, hubPage(page), grid);
      }
    });

    test("keeps its actions in the sticky region at the block end, inside the viewport, at the tap size, in en and ur with the longest labels", async ({ page }) => {
      const tap = await (async () => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await open(page, which, "en", "stress");
        return tokenPx(page, "--tap");
      })();
      for (const lang of ["en", "ur"] as const) {
        for (const [width, height] of [
          [390, 844],
          [699, 800],
          [800, 800],
          [1088, 800],
        ] as const) {
          await page.setViewportSize({ width, height });
          await open(page, which, lang, "stress");
          const bar = region(page);
          await expect(bar).toBeVisible();
          expect(await computed(bar, "position"), `${lang} ${width}px`).toBe("sticky");
          const barBox = await box(bar);
          expect(barBox.left, `${lang} ${width}px`).toBeGreaterThanOrEqual(-0.5);
          expect(barBox.right, `${lang} ${width}px`).toBeLessThanOrEqual(width + 0.5);
          // At the block end of the viewport while the page is at its top.
          expect(barBox.bottom, `${lang} ${width}px`).toBeLessThanOrEqual(height + 0.5);
          for (const id of which.actions) {
            const button = bar.getByTestId(id);
            await expect(button).toBeVisible();
            const buttonBox = await box(button);
            expect(buttonBox.height, `${id} ${lang} ${width}px`).toBeGreaterThanOrEqual(tap);
            expect(buttonBox.width, `${id} ${lang} ${width}px`).toBeGreaterThanOrEqual(tap);
            expect(buttonBox.left, `${id} ${lang} ${width}px`).toBeGreaterThanOrEqual(barBox.left - 0.5);
            expect(buttonBox.right, `${id} ${lang} ${width}px`).toBeLessThanOrEqual(barBox.right + 0.5);
          }
        }
      }
    });

    test("does not hide its last line behind the sticky actions when scrolled to the end", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 700 });
      await open(page, which, "en", "stress");
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const last = page.getByTestId("composer-aside").locator("li").last();
      expect((await box(last)).bottom).toBeLessThanOrEqual((await box(region(page))).top + 0.5);
    });

    test("has no control below the tap size, and no horizontal overflow, with the real English words at 390 and 1280 px", async ({ page }) => {
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await open(page, which, "en", "real");
        await expectNoHorizontalOverflow(page, hubPage(page), hubPage(page).locator(".layout-grid[data-two-column]"));
        expect(await smallTargets(page), `controls below the tap size at ${width}px`).toEqual([]);
      }
    });
  });
}

// "Log a disruption" (O-11): one column at every width, in the Screen's `log` width.
const logOpen = (page: Page, lang: HubLanguage, real = false) =>
  mount(
    page,
    "LogFixture",
    { texts: real ? REAL_TEXTS : longestTexts(lang), brand, screen: logScreen(plansFor(lang), NOW, { kind: "ack", ...(real ? {} : { text: longestText(lang) }) }) },
    { lang },
  );

test.describe("O-11 Log a disruption", () => {
  test("keeps the shell's breakpoint at viewports of 699 and 700 px, in en and ur, with no horizontal overflow", async ({ page }) => {
    await checkHubShellBoundaries(page, { open: (lang) => logOpen(page, lang) });
  });

  test("has no horizontal overflow at content widths of 799 and 800 px, in en and ur with the longest labels", async ({ page }) => {
    for (const lang of ["en", "ur"] as const) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await logOpen(page, lang);
      for (const width of [799, 800]) {
        await setContentWidth(page, width);
        await expectNoHorizontalOverflow(page, hubPage(page));
      }
    }
  });

  test("has no control below the tap size with the real English words at 390 and 1280 px", async ({ page }) => {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await logOpen(page, "en", true);
      await expectNoHorizontalOverflow(page, hubPage(page));
      expect(await smallTargets(page), `controls below the tap size at ${width}px`).toEqual([]);
    }
  });
});
