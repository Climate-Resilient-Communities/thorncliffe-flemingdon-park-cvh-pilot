import { expect, test, type Page } from "@playwright/test";
import type { AmbassadorAlert, AmbassadorPost } from "../../src/modules/alerting";
import { ambassadorHomeView, type AmbassadorHomeData, type AmbassadorHomeView, type Text } from "../../src/app/staff/ambassador/view";
import { expectNoHorizontalOverflow, hubPage } from "../helpers/hub-layout-boundaries";
import { REAL_TEXTS, hubBrand, longestTexts } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { longestLabels } from "../helpers/strings";

// S08.01: the Ambassador's home (A-01) inside the real Hub shell, on a phone first. One column at every width, the parts in the order a person needs them (their
// buildings, what is happening in them, their own posts, their round), no horizontal overflow at 320, 390, 699, 700 and 1280 px, in `en` and `ur` with the longest
// translated labels of the language in every place the screen shows text, and every link the full tap size. The words of the screen are the app's own.
const brand = hubBrand();

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const WIDTHS = [320, 390, 699, 700, 1280];

const alert = (over: Partial<AmbassadorAlert> = {}): AmbassadorAlert => ({
  alertId: ALERT,
  slug: "abcd2345",
  types: ["power", "elevator", "water"],
  headline: "Power is out in 4 Milepost Pl. Crews are on site. The elevators are down too.",
  verified: false,
  publishedAt: new Date("2026-10-04T14:00:00.000Z"),
  validUntil: new Date("2026-10-05T14:00:00.000Z"),
  buildings: ["4154146", "4154159"],
  ...over,
});
const post = (n: number, over: Partial<AmbassadorPost> = {}): AmbassadorPost => ({
  entryId: `01900000-0000-7000-8000-00000000e17${n}`,
  alertId: ALERT,
  types: ["water"],
  text: "No water on floors 3 to 5 since this morning.",
  state: "live",
  note: null,
  postedAt: new Date(Date.UTC(2026, 9, 4, 10 + n, 0, 0)),
  buildings: ["4154146"],
  ...over,
});

const data = (longest: string | null, over: Partial<AmbassadorHomeData> = {}): AmbassadorHomeData => ({
  buildings: [
    { rsn: "4154146", address: longest ?? "4 Milepost Pl", floorLabels: ["G", "1", "2", "3", "4", "5"] },
    { rsn: "4154159", address: "85-95 Thorncliffe Park Dr", floorLabels: null },
  ],
  alerts: [alert({ headline: longest ?? alert().headline }), alert({ alertId: "01900000-0000-7000-8000-00000000a1e8", slug: "wxyz2345", types: ["water"], verified: true, publishedAt: new Date("2026-10-04T15:00:00.000Z") })],
  posts: [
    post(1, { text: longest ?? post(1).text }),
    post(2, { state: "returned", note: longest ?? "Which floors is it on?" }),
    post(3, { state: "waiting" }),
    post(4, { state: "corrected" }),
  ],
  round: { requests: 12 },
  ...over,
});

function longestText(lang: string): Text {
  const { sentences, words, unbreakable } = longestLabels(lang);
  const pool = [...sentences, ...words, unbreakable, ...sentences.map((sentence) => `${sentence} ${sentence}`)];
  return (key) => pool[[...key].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 9973, 7) % pool.length];
}

const HOMES = [
  { name: "an Ambassador with two buildings, two alerts, four posts and an open round", over: {} },
  { name: "an Ambassador with nothing active, no posts and no round", over: { alerts: [], posts: [], round: null } },
  { name: "an Ambassador with no assignment", over: { buildings: [], alerts: [], posts: [], round: null } },
] as const;

type Words = "longest" | "real";
function viewOf(over: Partial<AmbassadorHomeData>, lang: string, words: Words): AmbassadorHomeView {
  if (words === "real") return ambassadorHomeView(data(null, over));
  return ambassadorHomeView(data(longestLabels(lang).unbreakable, over), longestText(lang));
}
const open = (page: Page, over: Partial<AmbassadorHomeData>, lang: "en" | "ur", words: Words) =>
  mount(page, "AmbassadorHomeFixture", { texts: words === "longest" ? longestTexts(lang) : REAL_TEXTS, brand, view: viewOf(over, lang, words) }, { lang });

for (const home of HOMES) {
  test.describe(`A-01 ${home.name}`, () => {
    test("has no horizontal overflow at 320, 390, 699, 700 and 1280 px, in en and ur with the longest labels", async ({ page }) => {
      for (const lang of ["en", "ur"] as const) {
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await open(page, home.over, lang, "longest");
          await expectNoHorizontalOverflow(page, hubPage(page));
        }
      }
    });

    test("has no link below the tap size and no horizontal overflow with the real English words at 390 and 1280 px", async ({ page }) => {
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await open(page, home.over, "en", "real");
        await expectNoHorizontalOverflow(page, hubPage(page));
        const minimum = parseFloat(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--tap-current")));
        const small = await hubPage(page)
          .locator("a[href]")
          .evaluateAll((links, least) => links.filter((link) => link.getBoundingClientRect().height < least).map((link) => link.outerHTML.slice(0, 80)), minimum);
        expect(small, `links below the tap size at ${width}px`).toEqual([]);
      }
    });
  });
}

test.describe("what the home says, with the app's own English words at 390 px", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, {}, "en", "real");
  });

  test("puts the buildings first, then what is happening, then their own posts, then their round", async ({ page }) => {
    const top = async (id: string) => (await page.getByTestId(id).boundingBox())!.y;
    expect(await top("assigned")).toBeLessThan(await top("amb-active"));
    expect(await top("amb-active")).toBeLessThan(await top("amb-posts"));
    expect(await top("amb-posts")).toBeLessThan(await top("amb-round"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("My buildings");
    await expect(page.getByTestId("assigned").getByRole("listitem")).toHaveText(["You are the ambassador for 4 Milepost Pl, floors G, 1, 2, 3, 4, 5.", "You are the ambassador for 85-95 Thorncliffe Park Dr, all floors."]);
  });

  test("lists the alerts newest first, each with who said it, whether it is verified and the one link to what residents read", async ({ page }) => {
    const alerts = page.getByTestId("amb-alert");
    await expect(alerts).toHaveCount(2);
    await expect(alerts.nth(0)).toContainText("Water");
    await expect(alerts.nth(0)).toContainText("From the Hub · Verified");
    await expect(alerts.nth(1)).toContainText("From the Hub · Not yet verified");
    await expect(alerts.nth(1).getByRole("link", { name: "See what residents read" })).toHaveAttribute("href", "/en/alerts/abcd2345");
  });

  test("lists their own posts, each with its state in words, and the Hub's note on a post it sent back", async ({ page }) => {
    await expect(page.getByTestId("amb-post")).toHaveCount(4);
    await expect(page.getByTestId("amb-post-state")).toHaveText(["Corrected", "Waiting for the Hub", "Sent back to you by the Hub", "Live. Not yet verified"]);
    await expect(page.getByTestId("amb-post-note")).toHaveText("Note from the Hub: Which floors is it on?");
  });

  test("shows their round with the number of requests, and a link to it (S08.07)", async ({ page }) => {
    await expect(page.getByTestId("amb-round-count")).toHaveText("12 check-in requests on your floors");
    await expect(page.getByTestId("amb-round").locator("a[href]")).toHaveCount(1);
    await expect(page.getByTestId("amb-round-link")).toHaveAttribute("href", "/staff/ambassador/round");
    await expect(page.getByTestId("amb-round-link")).toHaveText("Open my round");
    await expect(hubPage(page).getByRole("button")).toHaveCount(0);
  });

  test("links to posting (S08.02): a building update first, and an update about each alert, beside what residents read", async ({ page }) => {
    await expect(page.getByTestId("amb-post-link")).toHaveAttribute("href", "/staff/ambassador/post");
    await expect(page.getByTestId("amb-post-link")).toHaveText("Post a building update");
    await expect(page.getByTestId("amb-alert-post")).toHaveCount(2);
    await expect(page.getByTestId("amb-alert-post").nth(1)).toHaveAttribute("href", `/staff/ambassador/post?alert=${ALERT}`);
    // The home's links: posting, for each alert what residents read and an update about it, (S08.04) for each of their four posts where it stands,
    // and (S08.07) their open round.
    await expect(hubPage(page).locator("a[href]")).toHaveCount(10);
    await expect(page.getByTestId("amb-post-link-status")).toHaveCount(4);
    await expect(page.getByTestId("amb-post-link-status").first()).toHaveText("Where it stands");
  });
});
