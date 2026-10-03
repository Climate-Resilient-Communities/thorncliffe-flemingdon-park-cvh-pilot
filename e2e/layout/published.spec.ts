import { expect, test, type Page } from "@playwright/test";
import { approvalScreen, type ApprovalScreen, type Text } from "../../src/app/staff/alerts/approval/view";
import type { BuildingFloorPlan } from "../../src/modules/places";
import { APPROVER, PLANS, reviewOf, type ReviewOptions } from "../../test/helpers/approvalReview";
import { checkHubShellBoundaries, checkHubTwoColumnBoundaries, expectNoHorizontalOverflow, hubPage, type HubLanguage } from "../helpers/hub-layout-boundaries";
import { REAL_TEXTS, hubBrand, longestTexts } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { longestLabels } from "../helpers/strings";

// S04.10: the published confirmation (O-06), the screen of an approved entry, at content widths of 799 and 800 px (viewports of 1087 and 1088 px with
// the side navigation) and at viewports of 699 and 700 px, in `en` and `ur` with the longest translated labels of the language in every place the screen
// shows text. Below 800 px of content width it is one column, the main content first (what went where) and the aside (every language's web text and text
// message, one tap away) after it, filling the width; from 800 px two columns with the page's approved gap; and nothing overflows horizontally, with every
// language opened too. The checks are the shared boundary helpers of S01.16 (e2e/helpers/hub-layout-boundaries.ts), run on the app's own ApprovalBody
// inside the real Hub shell.
const brand = hubBrand();

interface Published {
  name: string;
  review: ReviewOptions;
}

const approved = (review: ReviewOptions = {}): ReviewOptions => ({ ...review, entry: { status: "approved", ...review.entry } });

const PAGES: Published[] = [
  { name: "O-06 an acknowledgement that went to the web in every language", review: approved() },
  { name: "O-06 an alert with languages that fell back to English", review: approved({ fallback: ["ur", "ps", "prs"], entry: { kind: "update" } }) },
  { name: "O-06 a drill", review: approved({ thread: { isDrill: true } }) },
  { name: "O-06 on a closed thread", review: approved({ thread: { status: "closed" } }) },
];

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

function screenOf(which: Published, lang: string, text?: Text): ApprovalScreen {
  const { sentences, unbreakable } = longestLabels(lang);
  return approvalScreen({
    review: reviewOf({ ...which.review, words: text ? { web: `${sentences[0]} ${unbreakable}`, sms: `${sentences[1] ?? sentences[0]}\n${unbreakable}\n${sentences[0]}` } : undefined }),
    plans: text ? plansFor(lang) : PLANS,
    pricePerSegmentCents: 1.5,
    viewerId: APPROVER,
    ...(text ? { text } : {}),
  });
}

type Props = Parameters<typeof mount<"ApprovalFixture">>[2];
type Words = "longest" | "real";
const open = (page: Page, which: Published, lang: HubLanguage, words: Words = "longest") =>
  mount(
    page,
    "ApprovalFixture",
    { texts: words === "longest" ? longestTexts(lang) : REAL_TEXTS, brand, screen: screenOf(which, lang, words === "real" ? undefined : longestText(lang)) } satisfies Props,
    { lang },
  );

const grid = (page: Page) => hubPage(page).locator(".layout-grid[data-two-column]");
const openEveryLanguage = (page: Page) => page.getByTestId("approval-aside").evaluate((aside) => aside.querySelectorAll("details").forEach((details) => (details.open = true)));

for (const which of PAGES) {
  test.describe(which.name, () => {
    test("is one column below 800 px of content width and two from 800 px, in en and ur with the longest labels, with no horizontal overflow", async ({ page }) => {
      await checkHubTwoColumnBoundaries(page, { open: (lang) => open(page, which, lang) });
    });

    test("keeps the shell's breakpoint at viewports of 699 and 700 px, in en and ur, with no horizontal overflow", async ({ page }) => {
      await checkHubShellBoundaries(page, { open: (lang) => open(page, which, lang) });
    });

    test("reads what went where first and the aside after it, in en and ur, with no sticky actions: there is nothing left to approve", async ({ page }) => {
      for (const lang of ["en", "ur"] as const) {
        await page.setViewportSize({ width: 390, height: 844 });
        await open(page, which, lang);
        await expect(grid(page).locator(":scope > *")).toHaveCount(2);
        await expect(grid(page).locator(":scope > *").nth(1)).toHaveAttribute("data-testid", "approval-aside");
        await expect(page.getByTestId("where")).toBeVisible();
        await expect(page.locator(".layout-screen__actions")).toHaveCount(0);
        await expectNoHorizontalOverflow(page, hubPage(page), grid(page));
      }
    });

    test("has no horizontal overflow with every language opened, in en and ur with the longest labels, at 390, 799 and 1280 px", async ({ page }) => {
      for (const lang of ["en", "ur"] as const) {
        for (const width of [390, 799, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          await open(page, which, lang);
          await openEveryLanguage(page);
          await expectNoHorizontalOverflow(page, hubPage(page), grid(page));
        }
      }
    });

    test("has no control below the tap size, and no horizontal overflow, with the real English words at 390 and 1280 px", async ({ page }) => {
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await open(page, which, "en", "real");
        await expectNoHorizontalOverflow(page, hubPage(page), grid(page));
        const minimum = parseFloat(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--tap-current")));
        const small = await hubPage(page)
          .locator("a[href], button, summary")
          .evaluateAll((controls, least) => controls.filter((control) => control.getBoundingClientRect().height < least).map((control) => control.outerHTML.slice(0, 80)), minimum);
        expect(small, `controls below the tap size at ${width}px`).toEqual([]);
      }
    });
  });
}

test.describe("what the confirmation says, with the app's own English words at 390 px", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test("shows what went where above the fold: the web with its languages, the languages that fell back, and the texts that wait for texting", async ({ page }) => {
    await open(page, PAGES[1], "en", "real");
    await expect(page.getByTestId("published-title")).toHaveText("The alert is out");
    await expect(page.getByTestId("where-web")).toContainText("in 13 languages, each in their own words");
    await expect(page.getByTestId("where-web-languages-en")).toHaveText("English");
    await expect(page.getByTestId("where-fallback")).toContainText("Residents reading in Urdu, Pashto and Dari see the English text");
    await expect(page.getByTestId("where-texts")).toContainText("Text sign-up is not open");
    for (const id of ["where-web", "where-fallback", "where-texts"]) {
      const where = (await page.getByTestId(id).boundingBox())!;
      expect(where.y, `${id} starts inside the screen`).toBeGreaterThanOrEqual(0);
    }
    // The web comes first, then the fallback, then the texts.
    const top = async (id: string) => (await page.getByTestId(id).boundingBox())!.y;
    expect(await top("where-web")).toBeLessThan(await top("where-fallback"));
    expect(await top("where-fallback")).toBeLessThan(await top("where-texts"));
  });

  test("says a drill reached nobody", async ({ page }) => {
    await open(page, PAGES[2], "en", "real");
    await expect(page.getByTestId("published-title")).toHaveText("Practice publish: nothing was sent to residents");
    await expect(page.getByTestId("where-texts")).toContainText("Not sent: practice only.");
    await expect(page.getByTestId("where-fallback")).toHaveCount(0);
  });

  test("offers the way back to the incidents, and no way to post to a closed thread", async ({ page }) => {
    await open(page, PAGES[0], "en", "real");
    await expect(page.getByTestId("next-home")).toHaveAttribute("href", "/staff");
    await expect(page.getByTestId("next-promote")).toBeVisible();
    await open(page, PAGES[3], "en", "real");
    await expect(page.getByTestId("next-home")).toBeVisible();
    await expect(page.getByTestId("next-promote")).toHaveCount(0);
    await expect(page.getByTestId("next-update")).toHaveCount(0);
  });
});
