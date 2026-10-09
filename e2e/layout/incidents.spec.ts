import { expect, test, type Page } from "@playwright/test";
import type { ClosedThread, IncidentRow, Incidents, RunningThread } from "../../src/modules/alerting";
import { incidentsView, type IncidentsView, type Text } from "../../src/app/staff/alerts/incidents/view";
import { ALERT, ENTRY, OTHER_ALERT, OTHER_ENTRY } from "../../test/helpers/approvalReview";
import { checkHubShellBoundaries, checkHubTwoColumnBoundaries, expectNoHorizontalOverflow, hubPage, type HubLanguage } from "../helpers/hub-layout-boundaries";
import { REAL_TEXTS, hubBrand, longestTexts } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { longestLabels } from "../helpers/strings";

// S04.10: the Hub home (O-01) at content widths of 799 and 800 px (viewports of 1087 and 1088 px with the side navigation) and at viewports of 699 and
// 700 px, in `en` and `ur` with the longest translated labels of the language in every place the screen shows text. Below 800 px of content width it
// is one column, the main content first (what waits for the person, the open threads, their own alerts) and the aside (the drills) after it, filling the
// width; from 800 px two columns with the page's approved gap; and nothing overflows horizontally. S05.03 adds what closed lately (resolved, expired, withdrawn, each with
// the words it ended with) between the open threads and the person's own alerts. The checks are the shared boundary helpers of S01.16
// (e2e/helpers/hub-layout-boundaries.ts), run on the app's own IncidentsList inside the real Hub shell.
const brand = hubBrand();
const NOW = new Date("2026-10-04T14:12:00.000Z");

const row = (over: Partial<IncidentRow> = {}): IncidentRow => ({
  alertId: ALERT,
  entryId: ENTRY,
  kind: "ack",
  status: "pending_approval",
  types: ["elevator", "power"],
  isDrill: false,
  version: 1,
  submittedAt: new Date("2026-10-04T14:00:00.000Z"),
  returnedNote: null,
  ...over,
});
const thread = (over: Partial<RunningThread> = {}): RunningThread => ({
  alertId: ALERT,
  slug: "abcd2345",
  isDrill: false,
  reportedAt: new Date("2026-10-04T13:30:00.000Z"),
  types: ["elevator", "power"],
  phase: "in_progress",
  validUntil: new Date("2026-10-05T14:00:00.000Z"),
  publishedAt: new Date("2026-10-04T14:00:00.000Z"),
  coveringKind: "update",
  ackOnly: false,
  entries: 3,
  ...over,
});

const closedThread = (over: Partial<ClosedThread> = {}): ClosedThread => ({
  alertId: "01900000-0000-7000-8000-00000000a1f0",
  slug: "closedaa",
  isDrill: false,
  types: ["elevator", "power"],
  reason: "resolved",
  closedAt: new Date("2026-10-04T14:00:00.000Z"),
  closingText: "Power is back on all floors.",
  ...over,
});

/** Enough of everything: entries waiting (one a drill), open threads (one an acknowledgement, one a drill), the person's own (one returned with a note), a drill of their own, and the three ways an alert closes. */
function fullHome(note: string): { incidents: Incidents; running: RunningThread[]; closed: ClosedThread[] } {
  return {
    closed: [
      closedThread({ closingText: note }),
      closedThread({ alertId: "01900000-0000-7000-8000-00000000a1f1", types: ["water", "flood", "fire"], reason: "expired", closingText: null, closedAt: new Date("2026-10-04T12:00:00.000Z") }),
      closedThread({ alertId: "01900000-0000-7000-8000-00000000a1f2", reason: "withdrawn", closingText: "Sent for the wrong building.", closedAt: new Date("2026-10-03T12:00:00.000Z") }),
      closedThread({ alertId: "01900000-0000-7000-8000-00000000a1f3", isDrill: true }),
    ],
    incidents: {
      waiting: [
        row(),
        row({ entryId: OTHER_ENTRY, alertId: OTHER_ALERT, kind: "update", types: ["water", "flood", "fire"], submittedAt: new Date("2026-10-04T13:20:00.000Z") }),
        row({ entryId: "01900000-0000-7000-8000-00000000e17b", alertId: OTHER_ALERT, isDrill: true }),
      ],
      mine: [
        row({ entryId: "01900000-0000-7000-8000-00000000e17c", status: "draft", submittedAt: null, returnedNote: note }),
        row({ entryId: "01900000-0000-7000-8000-00000000e17d", isDrill: true }),
      ],
    },
    running: [
      thread(),
      thread({ alertId: OTHER_ALERT, types: ["water"], ackOnly: true, coveringKind: "ack", phase: "problem", entries: 1, publishedAt: new Date("2026-10-04T14:05:00.000Z") }),
      thread({ alertId: "01900000-0000-7000-8000-00000000a1e9", isDrill: true }),
    ],
  };
}

/** Every text of the screen replaced by one of the language's longest labels (its longest sentences, words and one unbreakable token). */
function longestText(lang: string): Text {
  const { sentences, words, unbreakable } = longestLabels(lang);
  const pool = [...sentences, ...words, unbreakable, ...sentences.map((sentence) => `${sentence} ${sentence}`)];
  return (key) => pool[[...key].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 9973, 7) % pool.length];
}

interface Home {
  name: string;
  role: "coordinator" | "admin" | "director" | "ambassador";
  /** Nothing to show anywhere. */
  empty?: boolean;
}

const HOMES: Home[] = [
  { name: "O-01 a Coordinator's home with entries waiting, open threads, their own alerts and drills", role: "coordinator" },
  { name: "O-01 an Admin's home with nothing open", role: "admin", empty: true },
  { name: "O-01 a Director's read-only home", role: "director" },
  { name: "O-01 an Ambassador's home", role: "ambassador" },
];

function viewOf(home: Home, lang: string, longest: boolean): IncidentsView {
  const { unbreakable } = longestLabels(lang);
  const { incidents, running, closed } = home.empty ? { incidents: { waiting: [], mine: [] }, running: [], closed: [] } : fullHome(longest ? unbreakable : "Say which floors, and when the water will be back.");
  return incidentsView(incidents, home.role, longest ? longestText(lang) : undefined, running, NOW, closed);
}

type Words = "longest" | "real";
const open = (page: Page, home: Home, lang: HubLanguage, words: Words = "longest") =>
  mount(page, "IncidentsFixture", { texts: words === "longest" ? longestTexts(lang) : REAL_TEXTS, brand, view: viewOf(home, lang, words === "longest") }, { lang });

const grid = (page: Page) => hubPage(page).locator(".layout-grid[data-two-column]");

for (const home of HOMES) {
  test.describe(home.name, () => {
    test("is one column below 800 px of content width and two from 800 px, in en and ur with the longest labels, with no horizontal overflow", async ({ page }) => {
      await checkHubTwoColumnBoundaries(page, { open: (lang) => open(page, home, lang) });
    });

    test("keeps the shell's breakpoint at viewports of 699 and 700 px, in en and ur, with no horizontal overflow", async ({ page }) => {
      await checkHubShellBoundaries(page, { open: (lang) => open(page, home, lang) });
    });

    test("reads the main content first and the drills aside after it, in en and ur", async ({ page }) => {
      for (const lang of ["en", "ur"] as const) {
        await page.setViewportSize({ width: 390, height: 844 });
        await open(page, home, lang);
        await expect(grid(page).locator(":scope > *")).toHaveCount(2);
        // The second column holds the routine tasks and then the drills aside (a quiet home has no drills to list): the drills are never in the main column.
        const second = grid(page).locator(":scope > *").nth(1);
        await expect(second).toHaveAttribute("data-testid", "incidents-side");
        await expect(grid(page).locator(":scope > *").nth(0).getByTestId("incidents-drills")).toHaveCount(0);
        await expect(second.getByTestId("incidents-drills")).toHaveCount(await page.getByTestId("incidents-drills").count());
        await expectNoHorizontalOverflow(page, hubPage(page), grid(page));
      }
    });

    test("has no horizontal overflow at 390, 799 and 1280 px, in en and ur with the longest labels", async ({ page }) => {
      for (const lang of ["en", "ur"] as const) {
        for (const width of [390, 799, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          await open(page, home, lang);
          await expectNoHorizontalOverflow(page, hubPage(page), grid(page));
        }
      }
    });

    test("has no link below the tap size and no horizontal overflow with the real English words at 390 and 1280 px", async ({ page }) => {
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await open(page, home, "en", "real");
        await expectNoHorizontalOverflow(page, hubPage(page), grid(page));
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
  const VIEWPORT = { width: 390, height: 844 };

  test("puts what waits for approval first with how long each has waited, longest first, then the open threads newest first, then the person's own", async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await open(page, HOMES[0], "en", "real");
    const top = async (id: string) => (await page.getByTestId(id).boundingBox())!.y;
    expect(await top("incidents-waiting")).toBeLessThan(await top("incidents-running"));
    expect(await top("incidents-running")).toBeLessThan(await top("incidents-closed"));
    expect(await top("incidents-closed")).toBeLessThan(await top("incidents-mine"));
    expect(await top("incidents-mine")).toBeLessThan(await top("incidents-drills"));
    // UAT F-6: the drill waiting for approval is in the queue too, titled as a drill.
    await expect(page.getByTestId("waiting-item")).toHaveCount(3);
    await expect(page.getByTestId("incidents-waiting").getByTestId("waited")).toHaveText(["Waiting 52 minutes", "Waiting 12 minutes", "Waiting 12 minutes"]);
    await expect(page.getByTestId("incidents-waiting").locator('[data-drill="true"]')).toHaveCount(1);
    await expect(page.getByTestId("incidents-waiting").locator('[data-drill="true"]')).toContainText("Drill · Elevator, Power · Acknowledgement");
    // Open threads, the most recently published first.
    const running = page.getByTestId("running-item");
    await expect(running).toHaveCount(2);
    await expect(running.nth(0)).toContainText("Water");
    await expect(running.nth(1)).toContainText("Elevator, Power");
    // What closed lately: how each closed, most recently closed first, with the words it ended with and nothing to do with it.
    const closed = page.getByTestId("closed-item");
    await expect(closed).toHaveCount(3);
    await expect(closed.nth(0)).toContainText("Resolved ");
    await expect(closed.nth(1)).toContainText("Expired ");
    await expect(closed.nth(2)).toContainText("Withdrawn ");
    await expect(closed.nth(2).getByTestId("closed-final")).toHaveText("Final entry: Sent for the wrong building.");
    await expect(page.getByTestId("incidents-closed").locator("a[href]")).toHaveCount(0);
    // Drills are in a labelled section of their own, and nowhere else but the queue of what waits for approval.
    await expect(page.getByRole("complementary", { name: "Drills" })).toBeVisible();
    await expect(page.getByTestId("incidents-drills").getByTestId("drill-item")).toHaveCount(4);
    for (const id of ["incidents-running", "incidents-closed", "incidents-mine"]) await expect(page.getByTestId(id).locator('[data-drill="true"]')).toHaveCount(0);
  });

  test("gives a Director every open thread to read, and not one link to anything that changes it", async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await open(page, HOMES[2], "en", "real");
    await expect(page.getByTestId("read-only")).toHaveText("Read-only: you can see what is open here and change nothing.");
    await expect(page.getByTestId("running-item")).toHaveCount(2);
    await expect(page.getByTestId("incidents-waiting")).toHaveCount(0);
    await expect(page.getByTestId("incidents-start")).toHaveCount(0);
    await expect(hubPage(page).locator('a[href^="/staff/alerts/"]')).toHaveCount(0);
    await expect(hubPage(page).locator('a[href="/staff/coverage"]')).toHaveCount(1);
  });

  test("offers a Coordinator the two ways to start, and each open thread's one next step", async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await open(page, HOMES[0], "en", "real");
    await expect(page.getByTestId("start-log")).toHaveAttribute("href", "/staff/alerts/log");
    await expect(page.getByTestId("start-compose")).toHaveAttribute("href", "/staff/alerts/compose");
    await expect(page.getByTestId("incidents-running").getByRole("link", { name: "Add an update" })).toHaveCount(1);
    await expect(page.getByTestId("incidents-running").getByRole("link", { name: "Promote to full alert" })).toHaveCount(1);
    await expect(page.getByTestId("incidents-running").getByRole("link", { name: "Mark resolved" })).toHaveCount(2);
  });
});
