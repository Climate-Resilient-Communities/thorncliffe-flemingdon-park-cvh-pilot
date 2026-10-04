import { expect, test, type Page } from "@playwright/test";
import type { FollowInitial } from "../../src/app/staff/ambassador/status/FollowForms";
import { resolveScreen, type Text } from "../../src/app/staff/ambassador/status/view";
import { ALERT, COUNTS, screenOf } from "../helpers/ambassador-status";
import { expectNoHorizontalOverflow, hubPage } from "../helpers/hub-layout-boundaries";
import { REAL_TEXTS, hubBrand, longestTexts } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { longestLabels } from "../helpers/strings";

// S08.04: where an ambassador's post stands (A-03) and "Mark resolved" inside the real Hub shell, on a phone first: one column at every width, no horizontal overflow
// at 320, 390, 699, 700 and 1280 px, in `en` and `ur` with the longest translated labels of the language in every place the screen shows text, every link and
// button the full tap size, and the words of the states as the epic names them.
const brand = hubBrand();
const WIDTHS = [320, 390, 699, 700, 1280];
const CAN = { replace: true, resolve: true } as const;

function longestText(lang: string): Text {
  const { sentences, words, unbreakable } = longestLabels(lang);
  const pool = [...sentences, ...words, unbreakable];
  return (key, values) => {
    const base = pool[[...key].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 9973, 7) % pool.length];
    return values ? `${base} ${Object.values(values).join(" ")}` : base;
  };
}

type Built = ReturnType<typeof screenOf>;
const STATES: { name: string; build: (text?: Text) => Built; initial?: FollowInitial }[] = [
  { name: "a live post with every form", build: (text) => screenOf("live", { can: CAN }, {}, text), initial: undefined },
  { name: "every form open with problems shown", build: (text) => screenOf("live", { can: CAN }, {}, text), initial: { open: "correct", text: "", problems: ["text", "valid"] } },
  { name: "a post waiting for the Hub", build: (text) => screenOf("waiting", { types: ["fire"] }, {}, text) },
  { name: "an approved post with the progress of its texts", build: (text) => screenOf("approved", { approvedAt: new Date("2026-10-04T19:00:00.000Z") }, { counts: COUNTS }, text) },
  { name: "a post returned with the Hub's note", build: (text) => screenOf("returned", { note: "Which floors is it on? Say the building too." }, {}, text) },
  {
    name: "a withdrawn post",
    build: (text) => screenOf("withdrawn", { threadOpen: false, replacedWith: { entryId: ALERT, kind: "withdrawal", text: "This alert named the wrong place. It has been withdrawn.", at: new Date("2026-10-04T19:10:00.000Z") } }, {}, text),
  },
  { name: "a request held without signal", build: (text) => screenOf("live", { can: CAN }, {}, text), initial: { open: "resolve", state: { kind: "unsent" }, action: "resolve" } },
  { name: "the request sent", build: (text) => screenOf("live", { can: CAN }, {}, text), initial: { state: { kind: "done", live: true }, action: "correct" } },
];

const open = (page: Page, state: (typeof STATES)[number], lang: "en" | "ur", longest: boolean) =>
  mount(
    page,
    "AmbassadorStatusFixture",
    { texts: longest ? longestTexts(lang) : REAL_TEXTS, brand, screen: state.build(longest ? longestText(lang) : undefined), followInitial: state.initial },
    { lang },
  );

for (const state of STATES) {
  test.describe(`A-03 ${state.name}`, () => {
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
          .locator("a[href], button, summary")
          .evaluateAll((targets, least) => targets.filter((target) => target.getBoundingClientRect().height < least).map((target) => target.outerHTML.slice(0, 80)), minimum);
        expect(small, `targets below the tap size at ${width}px`).toEqual([]);
      }
    });
  });
}

test.describe("what the status screen says, with the app's own English words at 390 px", () => {
  const open390 = async (page: Page, state: (typeof STATES)[number]) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, state, "en", false);
  };

  test("names where the post stands as the epic does: Live. Not yet verified, Waiting for the Hub, Approved, Returned to you with the note, Withdrawn", async ({ page }) => {
    const titles: [number, string][] = [
      [0, "Live. Not yet verified"],
      [2, "Waiting for the Hub"],
      [3, "Approved"],
      [4, "Returned to you"],
      [5, "Withdrawn"],
    ];
    for (const [index, title] of titles) {
      await open390(page, STATES[index]);
      await expect(page.getByTestId("status-state").getByRole("heading")).toHaveText(title);
    }
    await open390(page, STATES[4]);
    await expect(page.getByTestId("status-note")).toHaveText("Note from the Hub: Which floors is it on? Say the building too.");
  });

  test("once approved shows how the texts are going: waiting, on their way, delivered, not delivered", async ({ page }) => {
    await open390(page, STATES[3]);
    const progress = page.getByTestId("status-progress");
    await expect(progress).toContainText("12 waiting to be sent");
    await expect(progress).toContainText("40 on their way");
    await expect(progress).toContainText("311 delivered");
    await expect(progress).toContainText("6 not delivered");
    // A post that is not approved shows none.
    await open390(page, STATES[0]);
    await expect(page.getByTestId("status-progress")).toHaveCount(0);
  });

  test("offers Correct, Withdraw and Mark resolved on a live post, each closed until chosen, and none on a post waiting for the Hub", async ({ page }) => {
    await open390(page, STATES[0]);
    for (const id of ["follow-correct", "follow-withdraw", "follow-resolve"]) await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId("follow-correct")).not.toHaveAttribute("open", "");
    await open390(page, STATES[2]);
    await expect(page.getByTestId("follow")).toHaveCount(0);
  });

  test("says a request held without signal is not sent yet and that the page must stay open", async ({ page }) => {
    await open390(page, STATES[6]);
    await expect(page.getByTestId("follow-unsent")).toContainText("Not sent yet. Keep this page open; it sends when you have signal.");
    await expect(page.getByRole("button", { name: "Send the final message" })).toBeDisabled();
  });
});

test.describe("Mark resolved", () => {
  const screen = (waiting: boolean) => resolveScreen({ alertId: ALERT, headline: "Power is out in 4 Milepost Pl. Crews are on site.", waitingFinal: waiting, entryId: "01900000-0000-7000-8000-00000000c003" });

  test("has no horizontal overflow and no small target at 320 to 1280 px", async ({ page }) => {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await mount(page, "AmbassadorResolveFixture", { texts: REAL_TEXTS, brand, screen: screen(false) });
      await expectNoHorizontalOverflow(page, hubPage(page));
      const minimum = parseFloat(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--tap-current")));
      const small = await hubPage(page)
        .locator("a[href], button, summary")
        .evaluateAll((targets, least) => targets.filter((target) => target.getBoundingClientRect().height < least).map((target) => target.outerHTML.slice(0, 80)), minimum);
      expect(small, `targets below the tap size at ${width}px`).toEqual([]);
    }
  });

  test("says what it does: a second person at the Hub approves the final message, and the alert stays open until then", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page, "AmbassadorResolveFixture", { texts: REAL_TEXTS, brand, screen: screen(false) });
    await expect(page.getByTestId("resolve-about")).toHaveText("The alert: Power is out in 4 Milepost Pl. Crews are on site.");
    await expect(page.getByTestId("follow-resolve")).toContainText("A second person at the Hub approves it, and only then does the alert close.");
    await mount(page, "AmbassadorResolveFixture", { texts: REAL_TEXTS, brand, screen: screen(true) });
    await expect(page.getByTestId("resolve-waiting")).toContainText("already waiting for the Hub");
    await expect(page.getByTestId("follow")).toHaveCount(0);
  });
});
