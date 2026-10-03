import { expect, test, type Page } from "@playwright/test";
import { composerScreen, startScreen, type ComposerScreen, type Text } from "../../src/app/staff/alerts/composer/view";
import type { EntryState, ThreadEntrySummary, ThreadSummary, UpdateStart } from "../../src/modules/alerting";
import type { BuildingFloorPlan } from "../../src/modules/places";
import { box, checkHubShellBoundaries, checkHubTwoColumnBoundaries, computed, expectNoHorizontalOverflow, hubPage, tokenPx, type HubLanguage } from "../helpers/hub-layout-boundaries";
import { REAL_TEXTS, hubBrand, longestTexts } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { longestLabels } from "../helpers/strings";

// S05.01: the promote page (O-13, "Promote to full alert") and the update page (O-14, "Add an update"), at content widths of 799 and 800 px (viewports of
// 1087 and 1088 px with the side navigation) and at viewports of 699 and 700 px, in `en` and `ur` with the longest translated labels of the language in
// every place the screens show text: the start of an update (nothing saved yet), a saved draft that changes who it is for, and a submitted update. Below
// 800 px of content width a page is one column, the main content first (the running alert, then the form) and the aside after it; from 800 px two
// columns with the page's approved gap; the actions stay in the sticky actions region at the block end in both; and nothing overflows horizontally. The
// checks are the shared boundary helpers of S01.16 (e2e/helpers/hub-layout-boundaries.ts), run on the app's own ComposerBody inside the real Hub shell.
const brand = hubBrand();

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ACK = "01900000-0000-7000-8000-00000000e100";
const FIRST = "01900000-0000-7000-8000-00000000e101";
const SECOND = "01900000-0000-7000-8000-00000000e102";
const DRAFT = "01900000-0000-7000-8000-00000000e177";
const NEW_ENTRY = "01900000-0000-7000-8000-00000000e999";
const KEY = "0f0e0d0c-0b0a-4908-8706-050403020100";
const NOW = new Date("2026-10-04T16:00:00.000Z");

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

const TYPES = ["power", "elevator"];
const THREAD_AUDIENCE = {
  scope: "buildings" as const,
  buildings: [{ rsn: "4154146", floors: [floorId("4154146", 3), floorId("4154146", 4), floorId("4154146", 5)] }, { rsn: "4154159", floors: null }],
  groups: ["seniors" as const],
  types: TYPES,
};
/** Wider than the thread's (a floor, a building and a group added) and narrower (a building dropped): both change lines are on the page. */
const CHANGED_AUDIENCE = {
  scope: "buildings" as const,
  buildings: [{ rsn: "4154146", floors: [floorId("4154146", 3), floorId("4154146", 4), floorId("4154146", 5), floorId("4154146", 6)] }, { rsn: "4154763", floors: null }],
  groups: ["families" as const, "seniors" as const],
  types: TYPES,
};

const published = (id: string, kind: ThreadEntrySummary["kind"], minutes: number, text: string, over: Partial<ThreadEntrySummary> = {}): ThreadEntrySummary => ({
  id,
  kind,
  status: "approved",
  webPublishedAt: new Date(Date.UTC(2026, 9, 4, 14, minutes, 0)),
  phase: "problem",
  validUntil: new Date("2026-10-05T14:00:00.000Z"),
  validUntilMode: "at",
  audience: THREAD_AUDIENCE,
  types: TYPES,
  text,
  version: 1,
  ...over,
});

/** A thread with an acknowledgement and two updates, the text of each long enough to fill a column. */
function threadOf(lang: string, entries: "ack" | "running"): ThreadSummary {
  const { sentences, unbreakable } = longestLabels(lang);
  const long = (n: number) => `${sentences[n % sentences.length]} ${unbreakable}`;
  const list =
    entries === "ack"
      ? [published(ACK, "ack", 5, long(0), { validUntilMode: "resolved" })]
      : [published(SECOND, "update", 50, long(2), { phase: "in_progress" }), published(FIRST, "update", 30, long(1)), published(ACK, "ack", 5, long(0))];
  return {
    thread: { id: ALERT, slug: "abcd2345", isDrill: false, reportedAt: new Date("2026-10-04T13:30:00.000Z"), status: "open" },
    entries: list,
    covering: list[0],
    validUntil: list[0].validUntil,
    ackOnly: entries === "ack",
  };
}

const startOf = (thread: ThreadSummary): UpdateStart => ({ audience: thread.covering!.audience, types: thread.covering!.types, validUntilMode: thread.covering!.validUntilMode, validUntil: thread.covering!.validUntil });

const FROZEN: EntryState["translations"] = [
  { lang: "fr", status: "translated", machine: true },
  { lang: "ur", status: "fallback_en", machine: false },
  { lang: "ps", status: "fallback_en", machine: false },
  { lang: "zh-Hant", status: "script_converted", machine: true },
];

function stateOf(lang: string, options: { entry?: Record<string, unknown>; audience?: typeof THREAD_AUDIENCE | typeof CHANGED_AUDIENCE; translations?: EntryState["translations"]; attempt?: Record<string, unknown> | null }): EntryState {
  return {
    thread: { id: ALERT, slug: "abcd2345", isDrill: false, reportedAt: new Date("2026-10-04T13:30:00.000Z"), status: "open" },
    entry: {
      id: DRAFT,
      alertId: ALERT,
      kind: "update",
      status: "draft",
      authorId: "01900000-0000-7000-8000-0000000000c1",
      editorIds: [],
      content: { text: longestLabels(lang).sentences[0], types: TYPES, audience: options.audience ?? THREAD_AUDIENCE, phase: "in_progress", validUntil: new Date("2026-10-05T16:00:00.000Z"), validUntilMode: "resolved" },
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
        : ({ key: KEY, kind: "submit", state: "committed", outcome: null, startedAt: NOW, finishedAt: NOW, budgetMs: 35000, progress: {}, resultVersion: 1, resultHash: "d".repeat(64), ...options.attempt } as NonNullable<EntryState["attempt"]>),
    translations: options.translations ?? [],
    priorKinds: ["ack"],
  };
}

interface UpdatePage {
  name: string;
  mode: "update" | "promote";
  screen: (lang: string, text?: Text) => ComposerScreen;
  actions: string[];
}

const PAGES: UpdatePage[] = [
  {
    name: "O-13 Promote to full alert, the start",
    mode: "promote",
    screen: (lang, text) => startScreen({ mode: "promote", alertId: ALERT, entryId: NEW_ENTRY, thread: threadOf(lang, "ack"), start: startOf(threadOf(lang, "ack")), plans: plansFor(lang), ...(text ? { text } : {}) }),
    actions: ["save-draft"],
  },
  {
    name: "O-14 Add an update, the start",
    mode: "update",
    screen: (lang, text) => startScreen({ mode: "update", alertId: ALERT, entryId: NEW_ENTRY, thread: threadOf(lang, "running"), start: startOf(threadOf(lang, "running")), plans: plansFor(lang), ...(text ? { text } : {}) }),
    actions: ["save-draft"],
  },
  {
    name: "O-14 an update draft that widens and narrows who it is for",
    mode: "update",
    screen: (lang, text) =>
      composerScreen({
        mode: "update",
        state: stateOf(lang, { audience: CHANGED_AUDIENCE }),
        plans: plansFor(lang),
        preview: { sms: { body: `${longestLabels(lang).sentences[0]}\n${longestLabels(lang).unbreakable}`, encoding: "ucs2", segments: 4 }, nineOneOneFirst: false },
        saved: false,
        now: NOW,
        thread: threadOf(lang, "running"),
        ...(text ? { text } : {}),
      }),
    actions: ["save-draft", "submit-button"],
  },
  {
    name: "O-13 a promotion draft",
    mode: "promote",
    screen: (lang, text) =>
      composerScreen({ mode: "promote", state: stateOf(lang, {}), plans: plansFor(lang), preview: { sms: { body: longestLabels(lang).sentences[0], encoding: "ucs2", segments: 2 }, nineOneOneFirst: true }, saved: false, now: NOW, thread: threadOf(lang, "ack"), ...(text ? { text } : {}) }),
    actions: ["save-draft", "submit-button"],
  },
  {
    name: "O-14 a submitted update, with languages that fell back",
    mode: "update",
    screen: (lang, text) =>
      composerScreen({
        mode: "update",
        state: stateOf(lang, { audience: CHANGED_AUDIENCE, entry: { status: "pending_approval", version: 2, contentHash: "d".repeat(64) }, translations: FROZEN, attempt: {} }),
        plans: plansFor(lang),
        preview: null,
        saved: false,
        now: NOW,
        thread: threadOf(lang, "running"),
        ...(text ? { text } : {}),
      }),
    actions: ["pull-back", "retry-translation"],
  },
];

type Props = Parameters<typeof mount<"ComposerFixture">>[2];

/**
 * `longest`: the longest labels of the language in the shell and in the screen. `stress`: the real shell (its top bar is as tall as the real one)
 * with the longest labels in the screen. `real`: the app's own English words.
 */
type Words = "longest" | "stress" | "real";
const open = (page: Page, which: UpdatePage, lang: HubLanguage, words: Words = "longest") =>
  mount(
    page,
    "ComposerFixture",
    { texts: words === "longest" ? longestTexts(lang) : REAL_TEXTS, brand, screen: which.screen(lang, words === "real" ? undefined : longestText(lang)) } satisfies Props,
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
        // The running alert is the first thing of the main column, above the form.
        await expect(grid.locator(":scope > *").nth(0).getByTestId("thread-digest")).toBeVisible();
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

test.describe("the running alert above the form, with the English words", () => {
  test("lists the entries newest first, each with its time and where things stood, and leaves the earlier ones readable", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, PAGES[1], "en", "real");
    const entries = page.getByTestId("thread-entry");
    await expect(entries).toHaveCount(3);
    const tops = await Promise.all([0, 1, 2].map(async (index) => (await box(entries.nth(index))).top));
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    await expect(entries.nth(0)).toContainText("Update, ");
    await expect(entries.nth(0)).toContainText("Work is under way");
    await expect(entries.nth(2)).toContainText("Acknowledgement, ");
    await expect(entries.nth(2)).toContainText("There is a problem");
    await expect(page.getByTestId("thread-valid-until")).toContainText("Valid until ");
  });

  test("shows 'Now also for: ...' and 'No longer for: ...' in the aside for an update that changes who it is for", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, PAGES[2], "en", "real");
    await expect(page.getByTestId("audience-also-for")).toContainText("Now also for: ");
    await expect(page.getByTestId("audience-no-longer-for")).toContainText("No longer for: ");
    expect(await page.getByTestId("composer-aside").getByTestId("audience-also-for").count()).toBe(1);
  });

  test("makes the phase required, with none ticked on a new update", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await open(page, PAGES[0], "en", "real");
    const radios = page.locator('input[name="phase"]');
    await expect(radios).toHaveCount(2);
    for (const index of [0, 1]) {
      await expect(radios.nth(index)).toHaveAttribute("required", "");
      await expect(radios.nth(index)).not.toBeChecked();
    }
    await expect(page.getByTestId("submit-button")).toHaveCount(0);
    await expect(page.getByTestId("save-draft")).toBeVisible();
  });
});

