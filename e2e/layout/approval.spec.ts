import { expect, test, type Page } from "@playwright/test";
import { approvalScreen, countChangedView, type ApprovalScreen, type Text } from "../../src/app/staff/alerts/approval/view";
import type { ApprovalInitial } from "../../src/app/staff/alerts/approval/ApprovalBody";
import type { BuildingFloorPlan } from "../../src/modules/places";
import { APPROVER, PLANS, floorId, reviewOf, type ReviewOptions } from "../../test/helpers/approvalReview";
import { box, checkHubShellBoundaries, checkHubTwoColumnBoundaries, computed, expectNoHorizontalOverflow, hubPage, tokenPx, type HubLanguage } from "../helpers/hub-layout-boundaries";
import { REAL_TEXTS, hubBrand, longestTexts } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { longestLabels } from "../helpers/strings";

// S04.07: the approval view of an alert (O-05) and of an ambassador's post (O-07) at content widths of 799 and 800 px (viewports of 1087 and
// 1088 px with the side navigation) and at viewports of 699 and 700 px, in `en` and `ur` with the longest translated labels of the language in
// every place the screens show text. Below 800 px of content width a view is one column, the main content first and the aside (every other language,
// one tap away) after it; from 800 px two columns with the page's approved gap; the approval actions stay in the sticky actions region at the block end
// in both; and nothing overflows horizontally, with every language opened too. The checks are the shared boundary helpers of S01.16
// (e2e/helpers/hub-layout-boundaries.ts), run on the app's own ApprovalBody inside the real Hub shell. The phone is checked as the story says: at
// 390 px, the English text, the audience, the channels, the recipient count, the cost and any fallback language are above the fold, and Approve is
// within thumb reach.
const brand = hubBrand();
const VIEWER = APPROVER;

/** Buildings with many floors, one whose address is a single unbreakable word (the longest word of the language, repeated). */
function plansFor(lang: string): BuildingFloorPlan[] {
  const { sentences, unbreakable } = longestLabels(lang);
  return [
    { ...PLANS[0], address: unbreakable },
    { ...PLANS[1], address: sentences[0] },
  ];
}

/** Every text of the screen replaced by one of the language's longest labels (its longest sentences, words and one unbreakable token). */
function longestText(lang: string): Text {
  const { sentences, words, unbreakable } = longestLabels(lang);
  const pool = [...sentences, ...words, unbreakable, ...sentences.map((sentence) => `${sentence} ${sentence}`)];
  return (key) => pool[[...key].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 9973, 7) % pool.length];
}

const OPEN: ReviewOptions["recipients"] = { open: true, total: 12, byLanguage: { en: 5, ur: 4, fr: 3 } };

interface Page_ {
  name: string;
  review: ReviewOptions;
  initial?: () => ApprovalInitial;
  /** The testids of the actions the sticky region shows. */
  actions: string[];
}

const PAGES: Page_[] = [
  { name: "O-05 an alert waiting for approval", review: {}, actions: ["approve-button", "return-button", "discard-button"] },
  { name: "O-05 with texting open, languages that fell back and a possible duplicate", review: { recipients: OPEN, fallback: ["ur", "ps", "prs"], duplicate: { alertId: "01900000-0000-7000-8000-00000000a1e8", entryId: "01900000-0000-7000-8000-00000000e178" } }, actions: ["approve-button", "return-button", "discard-button"] },
  { name: "O-07 an ambassador's post", review: { authorRole: "ambassador" }, actions: ["approve-button", "return-button", "discard-button"] },
  {
    // S05.01: an update to a running alert that widens who it is for (a floor and a building added, the people outside the groups reached) and narrows it (a building dropped):
    // "Now also for: ..." and "No longer for: ..." sit right under who it is for, above the fold, in every language with the longest labels.
    name: "O-05 an update that widens and narrows who it is for",
    review: {
      entry: { kind: "update" },
      threadAudience: {
        scope: "buildings",
        buildings: [{ rsn: "4154146", floors: [floorId("4154146", 2), floorId("4154146", 3)] }, { rsn: "7777777", floors: null }],
        groups: [],
        types: ["elevator", "power"],
      },
    },
    actions: ["approve-button", "return-button", "discard-button"],
  },
  { name: "O-05 returning it to its author with a note", review: {}, initial: () => ({ mode: "return" }), actions: ["send-back-button", "cancel-button"] },
  { name: "O-05 confirming a discard", review: {}, initial: () => ({ mode: "discard" }), actions: ["discard-confirm-button", "cancel-button"] },
  {
    name: "O-05 with a count that changed",
    review: { recipients: OPEN },
    initial: () => ({
      approve: {
        status: "count_changed",
        view: countChangedView({ review: reviewOf({ recipients: OPEN }), snapshot: { total: 14, byLanguage: { en: 5, ur: 4, fr: 5 } }, reviewed: { total: 12, byLanguage: { en: 5, ur: 4, fr: 3 } }, pricePerSegmentCents: 1.5 }),
      },
    }),
    actions: ["approve-button", "return-button", "discard-button"],
  },
];

function screenOf(which: Page_, lang: string, text?: Text): ApprovalScreen {
  const { sentences, unbreakable } = longestLabels(lang);
  return approvalScreen({
    review: reviewOf({ ...which.review, words: text ? { web: `${sentences[0]} ${unbreakable}`, sms: `${sentences[1] ?? sentences[0]}\n${unbreakable}\n${sentences[0]}` } : undefined }),
    // The real words are written with the real buildings; the longest labels, with buildings whose addresses are as long as the language's longest words.
    plans: text ? plansFor(lang) : PLANS,
    pricePerSegmentCents: 1.5,
    viewerId: VIEWER,
    ...(text ? { text } : {}),
  });
}

type Props = Parameters<typeof mount<"ApprovalFixture">>[2];

/**
 * `longest`: the longest labels of the language in the shell and in the screen. `stress`: the real shell (its top bar is as tall as the real one) with
 * the longest labels in the screen. `real`: the app's own English words.
 */
type Words = "longest" | "stress" | "real";
const open = (page: Page, which: Page_, lang: HubLanguage, words: Words = "longest") => {
  const screen = screenOf(which, lang, words === "real" ? undefined : longestText(lang));
  return mount(
    page,
    "ApprovalFixture",
    { texts: words === "longest" ? longestTexts(lang) : REAL_TEXTS, brand, screen, ...(which.initial ? { initial: which.initial() } : {}) } satisfies Props,
    { lang },
  );
};

/** Visible controls smaller than the tap rule: a link, a button, a field, a disclosure's line, and for a checkbox or a radio the label that is its target. */
async function smallTargets(page: Page) {
  return page.evaluate(() => {
    const minimum = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tap-current"));
    const target = (element: HTMLElement) => (element.matches('input[type="checkbox"], input[type="radio"]') ? (element.closest<HTMLElement>("label") ?? element) : element);
    return [...document.querySelectorAll<HTMLElement>("a[href], button, input:not([type=hidden]), select, textarea, summary")]
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
        await expect(grid.locator(":scope > *").nth(1)).toHaveAttribute("data-testid", "approval-aside");
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

    test("does not hide its last line behind the sticky actions when scrolled to the end, even with every language opened", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 700 });
      await open(page, which, "en", "stress");
      await page.getByTestId("approval-aside").evaluate((aside) => aside.querySelectorAll("details").forEach((details) => (details.open = true)));
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const last = page.getByTestId("approval-aside").locator("li").last();
      expect((await box(last)).bottom).toBeLessThanOrEqual((await box(region(page))).top + 0.5);
    });

    test("has no horizontal overflow with every language opened, in en and ur with the longest labels, at 390, 799 and 1280 px", async ({ page }) => {
      for (const lang of ["en", "ur"] as const) {
        for (const width of [390, 799, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          await open(page, which, lang);
          await page.getByTestId("approval-aside").evaluate((aside) => aside.querySelectorAll("details").forEach((details) => (details.open = true)));
          await expectNoHorizontalOverflow(page, hubPage(page), hubPage(page).locator(".layout-grid[data-two-column]"));
        }
      }
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

test.describe("the phone, at 390 px, with the app's own English words", () => {
  const VIEWPORT = { width: 390, height: 844 };

  test("shows the English text, the audience, the channels, the recipient count, the estimated cost, the valid-until and the languages that fell back above the fold, before any language", async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await open(page, PAGES[1], "en", "real");
    const barTop = (await box(region(page))).top;
    for (const id of ["english-body", "audience-sentence", "fact-channels", "recipient-count", "estimated-cost", "fact-valid-until", "fallback-summary"]) {
      const target = page.getByTestId(id);
      await expect(target, id).toBeVisible();
      const where = await box(target);
      expect(where.top, `${id} starts inside the screen`).toBeGreaterThanOrEqual(0);
      expect(where.bottom, `${id} ends above the actions, with no scrolling`).toBeLessThanOrEqual(barTop + 0.5);
    }
    // The other languages are one tap away: closed, below, and a tap opens one.
    const urdu = page.getByTestId("language-ur");
    await expect(urdu.locator("details")).not.toHaveAttribute("open", "");
    await urdu.locator("summary").click();
    await expect(page.getByTestId("web-ur")).toBeVisible();
    await expect(page.getByTestId("sms-ur")).toBeVisible();
  });

  test("shows the same above the fold when texting is not open yet, with 'Text sign-up is not open yet.', a count of 0 and the web as the only channel", async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await open(page, PAGES[0], "en", "real");
    const barTop = (await box(region(page))).top;
    for (const id of ["english-body", "audience-sentence", "fact-channels", "recipient-count", "sms-not-open", "estimated-cost", "fact-valid-until"]) {
      const where = await box(page.getByTestId(id));
      expect(where.bottom, `${id} ends above the actions, with no scrolling`).toBeLessThanOrEqual(barTop + 0.5);
    }
    await expect(page.getByTestId("sms-not-open")).toHaveText("Text sign-up is not open yet.");
    await expect(page.getByTestId("recipient-count")).toHaveText("0");
    await expect(page.getByTestId("fact-channels")).toContainText("Web app, in every launch language.");
    await expect(page.getByTestId("fact-channels")).not.toContainText("Text messages");
  });

  test("puts Approve within thumb reach: in the lower part of the screen, wholly inside it, at the tap size", async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await open(page, PAGES[0], "en", "real");
    const approve = await box(page.getByTestId("approve-button"));
    const tap = await tokenPx(page, "--tap");
    expect(approve.bottom).toBeLessThanOrEqual(VIEWPORT.height + 0.5);
    expect(approve.top).toBeGreaterThanOrEqual(VIEWPORT.height * 0.6);
    expect(approve.height).toBeGreaterThanOrEqual(tap);
    // It stays there while the page is scrolled to the end.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const scrolled = await box(page.getByTestId("approve-button"));
    expect(scrolled.top).toBeCloseTo(approve.top, 0);
  });

  test("shows what an update changes about who it is for, 'Now also for: ...' and 'No longer for: ...', above the fold with the audience (S05.01)", async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    const update = PAGES.find((candidate) => candidate.name.startsWith("O-05 an update"))!;
    await open(page, update, "en", "real");
    const barTop = (await box(region(page))).top;
    for (const id of ["update-note", "audience-sentence", "audience-also-for", "audience-no-longer-for", "fact-channels"]) {
      const where = await box(page.getByTestId(id));
      expect(where.top, `${id} starts inside the screen`).toBeGreaterThanOrEqual(0);
      expect(where.bottom, `${id} ends above the actions, with no scrolling`).toBeLessThanOrEqual(barTop + 0.5);
    }
    await expect(page.getByTestId("audience-also-for")).toContainText("Now also for: ");
    await expect(page.getByTestId("audience-no-longer-for")).toContainText("No longer for: ");
    // They sit under who it is for and above where it goes.
    const at = async (id: string) => (await box(page.getByTestId(id))).top;
    expect(await at("fact-audience")).toBeLessThan(await at("audience-also-for"));
    expect(await at("audience-no-longer-for")).toBeLessThan(await at("fact-channels"));
  });

  test("has Approve, Return to author and Discard in the sticky region and no way to edit", async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    for (const which of [PAGES[0], PAGES[2]]) {
      await open(page, which, "en", "real");
      const labels = await region(page).locator("button").allTextContents();
      expect(labels).toEqual(["Approve", "Return to author", "Discard"]);
      expect((await page.locator("body").innerText()).toLowerCase()).not.toMatch(/edit and approve|approve and edit/);
    }
  });
});
