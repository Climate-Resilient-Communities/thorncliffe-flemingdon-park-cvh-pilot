import { expect, test, type Page } from "@playwright/test";
import { composerScreen, replaceStartScreen, type ComposerScreen, type Text } from "../../src/app/staff/alerts/composer/view";
import type { EntryState, ThreadEntrySummary, ThreadSummary, UpdateStart } from "../../src/modules/alerting";
import type { BuildingFloorPlan } from "../../src/modules/places";
import { box, checkHubShellBoundaries, checkHubTwoColumnBoundaries, computed, expectNoHorizontalOverflow, hubPage, tokenPx, type HubLanguage } from "../helpers/hub-layout-boundaries";
import { REAL_TEXTS, hubBrand, longestTexts } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { longestLabels } from "../helpers/strings";

// S05.02: "Correct" and "Withdraw" (O-15), at content widths of 799 and 800 px (viewports of 1087 and 1088 px with the side navigation) and at viewports of 699 and
// 700 px, in `en` and `ur` with the longest translated labels of the language in every place the screens show text: the choice of the entry to correct, the correction
// form once an entry is chosen, the withdrawal form with the reason from the catalog, the composer of a correction and of a withdrawal that was saved, and a submitted
// withdrawal. Below 800 px of content width a page is one column, the main content first (the entries, the entry that is replaced, the running alert, then the form) and
// the aside after it; from 800 px two columns with the page's approved gap; the actions stay in the sticky actions region at the block end in both; and nothing overflows
// horizontally. The checks are the shared boundary helpers of S01.16 (e2e/helpers/hub-layout-boundaries.ts), run on the app's own ComposerBody inside the real Hub shell.
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

/** What a correction starts from: the entry that covers the thread (alerting's `updateStart`, which a browser test does not import: it pulls in the server). */
const startOf = (thread: ThreadSummary): UpdateStart => ({ audience: thread.covering!.audience, types: thread.covering!.types, validUntilMode: thread.covering!.validUntilMode, validUntil: thread.covering!.validUntil });

interface ReplacePage {
  name: string;
  mode: "correct" | "withdraw";
  screen: (lang: string, text?: Text) => ComposerScreen;
  actions: string[];
}

/** The entries that can be corrected or withdrawn: all of the running thread's. */
const startOfCorrection = (lang: string, target: ThreadEntrySummary | null, text?: Text) => {
  const thread = threadOf(lang, "running");
  return replaceStartScreen({ mode: "correct", alertId: ALERT, entryId: NEW_ENTRY, thread, targets: thread.entries, target, start: startOf(thread), plans: plansFor(lang), ...(text ? { text } : {}) });
};
const startOfWithdrawal = (lang: string, target: ThreadEntrySummary | null, text?: Text) => {
  const thread = threadOf(lang, "running");
  return replaceStartScreen({ mode: "withdraw", alertId: ALERT, entryId: NEW_ENTRY, thread, targets: thread.entries, target, start: null, plans: plansFor(lang), ...(text ? { text } : {}) });
};

const savedOf = (mode: "correct" | "withdraw", lang: string, text: Text | undefined, options: Parameters<typeof stateOf>[1] = {}) => {
  const thread = threadOf(lang, "running");
  const replaced = thread.entries[2];
  return composerScreen({
    mode,
    state: {
      ...stateOf(lang, options),
      entry: { ...stateOf(lang, options).entry, kind: mode === "correct" ? "correction" : "withdrawal", supersedesId: replaced.id, withdrawalReason: mode === "withdraw" ? "wrong_place" : null } as EntryState["entry"],
    },
    plans: plansFor(lang),
    preview: options.entry?.status === "pending_approval" ? null : { sms: { body: `${longestLabels(lang).sentences[0]}\n${longestLabels(lang).unbreakable}`, encoding: "ucs2", segments: 4 }, nineOneOneFirst: false },
    saved: false,
    now: NOW,
    thread,
    target: { kind: replaced.kind, publishedAt: replaced.webPublishedAt, text: replaced.text },
    ...(text ? { text } : {}),
  });
};

const PAGES: ReplacePage[] = [
  { name: "O-15 Correct, choosing the entry", mode: "correct", screen: (lang, text) => startOfCorrection(lang, null, text), actions: [] },
  { name: "O-15 Correct, the entry chosen", mode: "correct", screen: (lang, text) => startOfCorrection(lang, threadOf(lang, "running").entries[2], text), actions: ["save-draft"] },
  { name: "O-15 Withdraw, the entry chosen and the reason to choose", mode: "withdraw", screen: (lang, text) => startOfWithdrawal(lang, threadOf(lang, "running").entries[2], text), actions: ["save-draft"] },
  { name: "O-15 a correction draft that widens and narrows who it is for", mode: "correct", screen: (lang, text) => savedOf("correct", lang, text, { audience: CHANGED_AUDIENCE }), actions: ["save-draft", "submit-button"] },
  { name: "O-15 a withdrawal draft", mode: "withdraw", screen: (lang, text) => savedOf("withdraw", lang, text), actions: ["save-draft", "submit-button"] },
  {
    name: "O-15 a submitted withdrawal, with languages that fell back",
    mode: "withdraw",
    screen: (lang, text) => savedOf("withdraw", lang, text, { entry: { status: "pending_approval", version: 2, contentHash: "d".repeat(64) }, translations: FROZEN, attempt: {} }),
    actions: ["pull-back", "retry-translation"],
  },
];

type Props = Parameters<typeof mount<"ComposerFixture">>[2];

/**
 * `longest`: the longest labels of the language in the shell and in the screen. `stress`: the real shell (its top bar is as tall as the real one)
 * with the longest labels in the screen. `real`: the app's own English words.
 */
type Words = "longest" | "stress" | "real";
const open = (page: Page, which: ReplacePage, lang: HubLanguage, words: Words = "longest") =>
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
        // The running alert is in the main column, above the form, whatever the page.
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
          if (which.actions.length === 0) {
            await expect(bar).toHaveCount(0);
            continue;
          }
          await expect(bar).toBeVisible();
          expect(await computed(bar, "position"), `${lang} ${width}px`).toBe("sticky");
          const barBox = await box(bar);
          expect(barBox.left, `${lang} ${width}px`).toBeGreaterThanOrEqual(-0.5);
          expect(barBox.right, `${lang} ${width}px`).toBeLessThanOrEqual(width + 0.5);
          expect(barBox.bottom, `${lang} ${width}px`).toBeLessThanOrEqual(height + 0.5);
          if (which.actions.length === 0) await expect(bar).toHaveCount(0);
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
      if (which.actions.length === 0) return;
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


test.describe("the correction and withdrawal pages, with the English words", () => {
  test("lists the entries newest first, each a link that chooses it, with the one chosen marked", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, PAGES[1], "en", "real");
    const targets = page.getByTestId("target");
    await expect(targets).toHaveCount(3);
    await expect(targets.nth(2)).toHaveAttribute("data-selected", "true");
    await expect(targets.nth(0)).toContainText("Update, ");
    await expect(targets.nth(2)).toContainText("Acknowledgement, ");
    await expect(targets.nth(2).getByTestId("target-choose")).toHaveText("Chosen");
    await expect(page.getByTestId("replaces")).toContainText("The entry residents read now");
  });

  test("asks for the reason from the catalog, required, with no valid-until and no phase", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await open(page, PAGES[2], "en", "real");
    const radios = page.locator('input[name="reason"]');
    await expect(radios).toHaveCount(4);
    for (const index of [0, 1, 2, 3]) {
      await expect(radios.nth(index)).toHaveAttribute("required", "");
      await expect(radios.nth(index)).not.toBeChecked();
    }
    await expect(page.locator('input[name="valid-mode"]')).toHaveCount(0);
    await expect(page.locator('input[name="phase"]')).toHaveCount(0);
  });

  test("shows 'Now also for: ...' and 'No longer for: ...' in the aside for a correction that changes who it is for", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, PAGES[3], "en", "real");
    await expect(page.getByTestId("audience-also-for")).toContainText("Now also for: ");
    await expect(page.getByTestId("audience-no-longer-for")).toContainText("No longer for: ");
  });

  test("makes the phase of a correction required, with the entry's own ticked to be confirmed", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await open(page, PAGES[1], "en", "real");
    const radios = page.locator('input[name="phase"]');
    await expect(radios).toHaveCount(2);
    for (const index of [0, 1]) await expect(radios.nth(index)).toHaveAttribute("required", "");
  });
});
