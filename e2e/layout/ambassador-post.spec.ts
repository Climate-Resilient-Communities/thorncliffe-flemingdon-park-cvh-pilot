import { expect, test, type Page } from "@playwright/test";
import type { PostInitial } from "../../src/app/staff/ambassador/post/PostForm";
import { postScreen, type PostData, type Text } from "../../src/app/staff/ambassador/post/view";
import { expectNoHorizontalOverflow, hubPage } from "../helpers/hub-layout-boundaries";
import { REAL_TEXTS, hubBrand, longestTexts } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { longestLabels } from "../helpers/strings";

// S08.02: an ambassador's post (A-02) inside the real Hub shell, on a phone first: one column at every width, no horizontal overflow at 320, 390, 699, 700 and
// 1280 px, in `en` and `ur` with the longest translated labels of the language in every place the screen shows text, every link and button the full tap size,
// the attribution residents will read shown before the button, and the 911 block placed first when Other is chosen.
const brand = hubBrand();
const WIDTHS = [320, 390, 699, 700, 1280];
const FLOORS = ["G", ...Array.from({ length: 24 }, (_, index) => String(index + 1))].map((label, index) => ({ id: `01900000-0000-7000-8000-0000000f${String(index + 1).padStart(4, "0")}`, label }));
const data = (address = "4 Milepost Pl", over: Partial<PostData> = {}): PostData => ({
  buildings: [
    { rsn: "4154146", address, floors: FLOORS },
    { rsn: "4154159", address: "85-95 Thorncliffe Park Dr", floors: FLOORS.slice(0, 6) },
  ],
  thread: null,
  ids: { alertId: "01900000-0000-7000-8000-00000000a1e7", entryId: "01900000-0000-7000-8000-00000000e17a" },
  ...over,
});

function longestText(lang: string): Text {
  const { sentences, words, unbreakable } = longestLabels(lang);
  const pool = [...sentences, ...words, unbreakable];
  // Placeholders the form fills itself stay, so the filled text is as long as it gets.
  return (key, values) => {
    const base = pool[[...key].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 9973, 7) % pool.length];
    return values ? `${base} ${Object.values(values).join(" ")}` : base;
  };
}

const STATES: { name: string; initial: PostInitial; over?: Partial<PostData> }[] = [
  { name: "a new post", initial: {} },
  { name: "Other chosen with every problem shown and some floors listed", initial: { types: ["other"], floorsMode: "list", problems: ["types", "floors", "phase", "line", "valid"] } },
  { name: "a post held without signal", initial: { types: ["power"], phase: "problem", text: "Power is out.", state: { kind: "unsent" } } },
  { name: "a practice post in a drill", initial: { floorsMode: "range" }, over: { thread: { id: "01900000-0000-7000-8000-00000000d111", isDrill: true, headline: "Drill: the elevator is out.", types: ["elevator"] } } },
  { name: "the post sent", initial: { state: { kind: "done" } } },
];

const open = (page: Page, state: (typeof STATES)[number], lang: "en" | "ur", longest: boolean) =>
  mount(
    page,
    "AmbassadorPostFixture",
    {
      texts: longest ? longestTexts(lang) : REAL_TEXTS,
      brand,
      screen: longest ? postScreen(data(longestLabels(lang).unbreakable, state.over), longestText(lang)) : postScreen(data(undefined, state.over)),
      initial: state.initial,
    },
    { lang },
  );

for (const state of STATES) {
  test.describe(`A-02 ${state.name}`, () => {
    test("has no horizontal overflow at 320, 390, 699, 700 and 1280 px, in en and ur with the longest labels", async ({ page }) => {
      for (const lang of ["en", "ur"] as const) {
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await open(page, state, lang, true);
          await expectNoHorizontalOverflow(page, hubPage(page));
        }
      }
    });

    test("has no link or button below the tap size with the real English words at 390 and 1280 px", async ({ page }) => {
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await open(page, state, "en", false);
        await expectNoHorizontalOverflow(page, hubPage(page));
        const minimum = parseFloat(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--tap-current")));
        const small = await hubPage(page)
          .locator("a[href], button")
          .evaluateAll((targets, least) => targets.filter((target) => target.getBoundingClientRect().height < least).map((target) => target.outerHTML.slice(0, 80)), minimum);
        expect(small, `targets below the tap size at ${width}px`).toEqual([]);
      }
    });
  });
}

test.describe("what the post screen says, with the app's own English words at 390 px", () => {
  test("shows the attribution residents will read before the button, a building ambassador of the building and never a name", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, STATES[0], "en", false);
    await expect(page.getByTestId("post-appears-as")).toHaveText("This will appear as: Building ambassador, 4 Milepost Pl");
    const attribution = (await page.getByTestId("post-appears-as").boundingBox())!.y;
    const button = (await page.getByRole("button", { name: /^Post update:/ }).boundingBox())!.y;
    expect(attribution).toBeLessThan(button);
    await expect(page.getByRole("button", { name: "Post update: whole building" })).toBeVisible();
    // Heat, smoke and winter storm are not offered.
    await expect(hubPage(page).getByRole("checkbox", { name: /Heat|Smoke|Winter/ })).toHaveCount(0);
    await expect(page.getByText("Heat and smoke come from the Hub for the whole neighbourhood.")).toBeVisible();
  });

  test("puts the 911 block first when Other is chosen, before the floors and the line Other requires", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, STATES[1], "en", false);
    const top = async (selector: string) => (await page.locator(selector).first().boundingBox())!.y;
    expect(await top('[data-component="not-911"]')).toBeLessThan(await top("#post-floors"));
    expect(await top('[data-component="not-911"]')).toBeLessThan(await top("#post-text"));
    await expect(page.locator('label[for="post-text"]')).toContainText("Say what is happening, in one line");
    await expect(page.getByText("Other needs one line: say what is happening.")).toBeVisible();
  });

  test("says a post held without signal is not sent yet, that the page must stay open, and disables the button", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, STATES[2], "en", false);
    await expect(page.getByTestId("post-unsent")).toContainText("Not sent yet. Keep this page open; it sends when you have signal.");
    await expect(page.getByTestId("post-unsent")).toContainText("If you close this page, this update is lost.");
    await expect(page.getByRole("button", { name: /^Post update:/ })).toBeDisabled();
  });

  test("marks a practice post in a drill as an exercise that goes to the Hub only", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, STATES[3], "en", false);
    await expect(page.getByTestId("post-exercise")).toHaveText("Exercise: this post is practice. It goes to the Hub only, never to residents.");
    await expect(page.getByText("Practice: this goes to the Hub only. Nothing is sent to residents.")).toBeVisible();
  });
});
