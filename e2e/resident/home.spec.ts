import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import { BUILDINGS, FLOOR, seedChoices, stubBuildingList } from "./choices-fixture";
import { feedOf, stubFeed } from "./home-fixture";
import { expectBaseline, openResident } from "./helpers";

// S02.11: home (R-03) shows the resident's buildings first, each with its status in words, icon and colour and a link
// to its page; the neighbourhood; and the current alerts. The feed is fetched again every 60 seconds and an answer older
// than one already seen is discarded. The choices stay on the phone (AD-3).

const MILEPOST = BUILDINGS[0].rsn; // 4 Milepost Pl, Thorncliffe Park
const OVERLEA = BUILDINGS[3].rsn; // 10 Overlea Blvd, Flemingdon Park

const choose = (page: Page, ...buildings: string[]) => seedChoices(page, JSON.stringify({ v: 1, lang: "en", welcomed: true, buildings }));

const ready = (page: Page) => expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "ready");
const statusOf = (page: Page, testId: string) => page.getByTestId(testId).getByTestId("home-status");

test.beforeEach(async ({ page }) => {
  await stubBuildingList(page);
});

test.describe("a resident with chosen buildings", () => {
  test("sees each chosen building first, in the order chosen, with its status in words, icon and colour, and a link to its page", async ({ page }) => {
    await stubFeed(page, [feedOf(5, { buildings: { [MILEPOST]: { status: "active", verified: false }, [OVERLEA]: { status: "none" } } })]);
    await choose(page, OVERLEA, MILEPOST);

    await openResident(page, "/en", 390);
    await ready(page);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Alerts now");
    const rows = page.getByTestId("home-buildings").locator("li");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("10 Overlea Blvd");
    await expect(rows.nth(1)).toContainText("4 Milepost Pl");
    // The buildings come before the neighbourhood and the alerts.
    const order = await page.evaluate(() => [...document.querySelectorAll('[data-testid="home-buildings"], [data-testid="home-neighbourhoods"], [data-testid="home-alerts"]')].map((element) => element.getAttribute("data-testid")));
    expect(order).toEqual(["home-buildings", "home-neighbourhoods", "home-alerts"]);

    // Text: the words. Never colour alone.
    await expect(statusOf(page, `home-building-${OVERLEA}`)).toHaveText("Nothing active");
    await expect(statusOf(page, `home-building-${MILEPOST}`)).toHaveText("Active problem");
    await expect(page.getByTestId(`home-building-${MILEPOST}`).getByTestId("home-unverified")).toHaveText("Not yet verified");
    // Icon: each status has its own shape, drawn as a mask the size of an icon.
    const looks = await page.evaluate(
      ([a, b]) => {
        const look = (id: string) => {
          const status = document.querySelector(`[data-testid="${id}"] [data-testid="home-status"]`)!;
          const icon = status.querySelector(".home-ico")!;
          const style = getComputedStyle(icon);
          return { mask: style.maskImage || style.webkitMaskImage, width: style.width, colour: getComputedStyle(status).color };
        };
        return [look(a), look(b)];
      },
      [`home-building-${OVERLEA}`, `home-building-${MILEPOST}`],
    );
    for (const look of looks) {
      expect(look.mask).toMatch(/^url\(/);
      expect(parseFloat(look.width)).toBeGreaterThan(10);
    }
    expect(looks[0].mask).not.toBe(looks[1].mask);
    // Colour: a different one for the active problem.
    expect(looks[0].colour).not.toBe(looks[1].colour);
    expect(looks[1].colour).toBe("rgb(179, 38, 30)");
    // The link to the building's page.
    await expect(page.getByTestId(`home-building-${MILEPOST}`)).toHaveAttribute("href", `/en/buildings/${MILEPOST}`);
    await page.getByTestId(`home-building-${MILEPOST}`).click();
    await page.waitForURL(`**/en/buildings/${MILEPOST}`);
  });

  test("shows each status with its own words and icon, and the neighbourhoods of the chosen buildings only", async ({ page }) => {
    await stubFeed(page, [
      feedOf(2, {
        buildings: { [BUILDINGS[0].rsn]: { status: "active" }, [BUILDINGS[1].rsn]: { status: "in_progress" }, [BUILDINGS[2].rsn]: { status: "resolved" } },
        neighbourhoods: { TP: { status: "in_progress" }, FP: { status: "active" } },
      }),
    ]);
    await choose(page, BUILDINGS[0].rsn, BUILDINGS[1].rsn, BUILDINGS[2].rsn);

    await openResident(page, "/en", 390);
    await ready(page);

    const words = await page.getByTestId("home-buildings").getByTestId("home-status").allTextContents();
    expect(words).toEqual(["Active problem", "Work in progress", "Resolved"]);
    const kinds = await page.getByTestId("home-buildings").getByTestId("home-status").evaluateAll((all) => all.map((one) => one.getAttribute("data-status")));
    expect(kinds).toEqual(["active", "in_progress", "resolved"]);
    // All three are in Thorncliffe Park: one neighbourhood, named, with its own status.
    await expect(page.getByTestId("home-neighbourhoods").locator("li")).toHaveCount(1);
    await expect(page.getByTestId("home-neighbourhood-TP")).toContainText("Thorncliffe Park");
    await expect(statusOf(page, "home-neighbourhood-TP")).toHaveText("Work in progress");
  });

  test("with no threads says 'No current alerts' in the page language: the interface string with its visible [EN] where it is not translated yet", async ({ page }) => {
    await stubFeed(page, [feedOf(1)]);
    await choose(page, MILEPOST);

    await openResident(page, "/en", 390);
    await ready(page);
    await expect(page.getByTestId("no-current-alerts")).toContainText("No current alerts");

    await openResident(page, "/ur", 390);
    await ready(page);
    await expect(page.getByTestId("no-current-alerts")).toContainText("[EN] No current alerts");
    await expect(page.getByTestId("no-current-alerts").locator("p").first()).toHaveAttribute("lang", "en");
  });

  test("says Not known, never 'Nothing active', when the feed cannot be read, and says so", async ({ page }) => {
    await stubFeed(page, ["unavailable"]);
    await choose(page, MILEPOST);

    await openResident(page, "/en", 390);
    await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "failed");

    await expect(statusOf(page, `home-building-${MILEPOST}`)).toHaveText("Not known");
    await expect(statusOf(page, "home-neighbourhood-TP")).toHaveText("Not known");
    await expect(page.getByTestId("feed-failed")).toContainText("We could not check for alerts");
    await expect(page.getByTestId("no-current-alerts")).toHaveCount(0);
    await expect(page.getByText("Nothing active")).toHaveCount(0);
  });

  test("asks for the building list once for the visit: home shares the gate's list", async ({ page }) => {
    await stubFeed(page, [feedOf(1)]);
    await choose(page, MILEPOST);
    const lists: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/buildings") lists.push(request.url());
    });

    await openResident(page, "/en", 390);
    await ready(page);
    await page.waitForLoadState("networkidle");

    expect(lists).toHaveLength(1);
    await expect(page.getByTestId(`home-building-${MILEPOST}`)).toContainText("4 Milepost Pl");
  });
});

test.describe("a resident with no chosen building", () => {
  test("sees the neighbourhood view and an invitation to choose where they live", async ({ page }) => {
    await stubFeed(page, [feedOf(1, { neighbourhoods: { FP: { status: "in_progress" } } })]);
    await choose(page);

    await openResident(page, "/en", 390);
    await ready(page);

    await expect(page.getByTestId("home-buildings")).toHaveCount(0);
    await expect(page.getByTestId("home-neighbourhoods").locator("li")).toHaveCount(2);
    await expect(statusOf(page, "home-neighbourhood-TP")).toHaveText("Nothing active");
    await expect(statusOf(page, "home-neighbourhood-FP")).toHaveText("Work in progress");
    const invite = page.getByTestId("home-choose-building");
    await expect(invite).toHaveText("Choose your building to see its alerts first");
    await invite.click();
    await page.waitForURL("**/en/choices/place");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Get alerts for your building");
  });

  test("keeps the link to what the resident has told the CVH", async ({ page }) => {
    await stubFeed(page, [feedOf(1)]);
    await choose(page);

    await openResident(page, "/en", 390);

    await expect(page.getByTestId("choices-link")).toHaveAttribute("href", "/en/choices");
  });
});

/**
 * Counts the feed requests the page makes, as the browser reports them (not as the stub answers them), and can wait
 * until every request made so far has been reported: a request sent before a later one is reported before it, so one
 * round trip of our own (a request to a path the stub does not answer) is the barrier. A negative check ("no ask yet")
 * then needs no sleep.
 */
function countFeedRequests(page: Page) {
  let count = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/feed") count += 1;
  });
  return {
    count: () => count,
    settled: () => roundTrip(page),
  };
}

const roundTrip = (page: Page) => page.evaluate(() => fetch("/favicon.ico").then(() => undefined, () => undefined));

const setVisibility = (page: Page, state: "hidden" | "visible") =>
  page.evaluate((value) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);

/** From now on /api/feed is held: each request is kept, unanswered, until the test answers it. */
async function holdFeed(page: Page) {
  await page.unroute("**/api/feed**");
  const held: Route[] = [];
  await page.route("**/api/feed**", (route) => {
    held.push(route);
  });
  return held;
}

test.describe("the feed is fetched again every 60 seconds", () => {
  test("home asks again after 60 seconds, again after another 60, and shows what the newer answer says", async ({ page }) => {
    const requests = countFeedRequests(page);
    await stubFeed(page, [feedOf(1), feedOf(2, { buildings: { [MILEPOST]: { status: "active" } } }), feedOf(3, { buildings: { [MILEPOST]: { status: "resolved" } } })]);
    await page.clock.install({ time: new Date("2026-10-01T12:00:00Z") });
    await choose(page, MILEPOST);

    await openResident(page, "/en", 390);
    await ready(page);
    await expect(statusOf(page, `home-building-${MILEPOST}`)).toHaveText("Nothing active");
    expect(requests.count()).toBe(1);

    await page.clock.fastForward(59_000);
    await requests.settled();
    expect(requests.count()).toBe(1);

    await page.clock.fastForward(1_000);
    await expect(statusOf(page, `home-building-${MILEPOST}`)).toHaveText("Active problem");
    expect(requests.count()).toBe(2);

    await page.clock.fastForward(60_000);
    await expect(statusOf(page, `home-building-${MILEPOST}`)).toHaveText("Resolved");
    expect(requests.count()).toBe(3);
  });

  test("discards an answer with a lower feed_version than the highest seen, keeps the screen as it was, and asks again a few seconds later", async ({ page }) => {
    const requests = countFeedRequests(page);
    await stubFeed(page, [
      feedOf(5, { buildings: { [MILEPOST]: { status: "active" } } }),
      feedOf(3, { buildings: { [MILEPOST]: { status: "none" } } }),
      feedOf(6, { buildings: { [MILEPOST]: { status: "resolved" } } }),
    ]);
    await page.clock.install({ time: new Date("2026-10-01T12:00:00Z") });
    await choose(page, MILEPOST);

    await openResident(page, "/en", 390);
    await ready(page);
    await expect(statusOf(page, `home-building-${MILEPOST}`)).toHaveText("Active problem");

    // An older copy (feed_version 3) arrives after version 5 was seen: the screen does not go back, and it is no failure.
    await page.clock.fastForward(60_000);
    await expect.poll(requests.count).toBe(2);
    await requests.settled();
    await expect(statusOf(page, `home-building-${MILEPOST}`)).toHaveText("Active problem");
    await expect(page.getByTestId("feed-failed")).toHaveCount(0);

    // The retry, 5 seconds later, is answered with version 6.
    await page.clock.fastForward(5_000);
    await expect(statusOf(page, `home-building-${MILEPOST}`)).toHaveText("Resolved");
    expect(requests.count()).toBe(3);
  });

  test("a lower feed_version on coming back to home does not leave every status on 'Checking' for a minute: it asks again within seconds", async ({ page }) => {
    const requests = countFeedRequests(page);
    // The first answer is version 9. The page stays open, so 9 is remembered when home is opened again: that ask is answered with 4, the retry with 9.
    await stubFeed(page, [feedOf(9, { buildings: { [MILEPOST]: { status: "active" } } }), feedOf(4), feedOf(9, { buildings: { [MILEPOST]: { status: "active" } } })]);
    await page.clock.install({ time: new Date("2026-10-01T12:00:00Z") });
    await choose(page, MILEPOST);

    await openResident(page, "/en", 390);
    await ready(page);
    await page.getByTestId(`home-building-${MILEPOST}`).click();
    await page.waitForURL(`**/en/buildings/${MILEPOST}`);
    await page.goBack();
    await expect.poll(requests.count).toBe(2);
    await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "loading");
    await expect(statusOf(page, `home-building-${MILEPOST}`)).toHaveText("Checking for alerts");

    await page.clock.fastForward(5_000);
    await ready(page);
    await expect(statusOf(page, `home-building-${MILEPOST}`)).toHaveText("Active problem");
    expect(requests.count()).toBe(3);
  });

  test("keeps the last answer on screen, and says so, when a later ask fails", async ({ page }) => {
    await stubFeed(page, [feedOf(4, { buildings: { [MILEPOST]: { status: "active" } } }), "unavailable"]);
    await page.clock.install({ time: new Date("2026-10-01T12:00:00Z") });
    await choose(page, MILEPOST);

    await openResident(page, "/en", 390);
    await ready(page);
    await page.clock.fastForward(60_000);

    await expect(page.getByTestId("feed-failed")).toContainText("We could not check for alerts");
    await expect(page.getByTestId("feed-last-loaded")).toContainText("Showing what was last loaded 1 minute ago");
    await expect(statusOf(page, `home-building-${MILEPOST}`)).toHaveText("Active problem");
  });

  test("says so, and never shows 'Nothing active' as current, when the feed stops answering", async ({ page }) => {
    await stubFeed(page, [feedOf(4)]);
    await page.clock.install({ time: new Date("2026-10-01T12:00:00Z") });
    await choose(page, MILEPOST);

    await openResident(page, "/en", 390);
    await ready(page);
    await expect(statusOf(page, `home-building-${MILEPOST}`)).toHaveText("Nothing active");
    await expect(page.getByTestId("feed-failed")).toHaveCount(0);

    // From now on the feed route never answers.
    const held = await holdFeed(page);

    // The ask at 60 seconds hangs; it is given up after 20 seconds and the screen says the answer is old.
    await page.clock.fastForward(60_000);
    await expect.poll(() => held.length).toBe(1);
    await page.clock.fastForward(20_000);
    await expect(page.getByTestId("feed-failed")).toContainText("We could not check for alerts");
    await expect(page.getByTestId("feed-last-loaded")).toContainText("Showing what was last loaded");
    await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "ready");

    // The next tick asks again and the note stays.
    await page.clock.fastForward(40_000);
    await expect.poll(() => held.length).toBe(2);
    await expect(page.getByTestId("feed-failed")).toContainText("We could not check for alerts");
  });

  test("a failure is announced once: the live region does not change at later polls, and the age shown outside it does", async ({ page }) => {
    await stubFeed(page, [feedOf(4, { buildings: { [MILEPOST]: { status: "active" } } }), "unavailable"]);
    await page.clock.install({ time: new Date("2026-10-01T12:00:00Z") });
    await choose(page, MILEPOST);

    await openResident(page, "/en", 390);
    await ready(page);
    await page.clock.fastForward(60_000);
    await expect(page.getByTestId("feed-failed")).toBeVisible();
    const announced = await page.getByTestId("feed-status").innerText();
    expect(announced).toContain("We could not check for alerts");
    expect(announced).not.toMatch(/ago|minute/);
    await expect(page.getByTestId("feed-last-loaded")).toContainText("1 minute ago");
    await page.evaluate(() => {
      const changes: string[] = [];
      (window as unknown as { __liveChanges: string[] }).__liveChanges = changes;
      new MutationObserver((records) => records.forEach((record) => changes.push(record.type))).observe(document.querySelector('[data-testid="feed-status"]')!, { subtree: true, childList: true, characterData: true, attributes: true });
    });

    // Three more polls fail too, and the data on screen is 4 minutes old by now.
    for (let minute = 0; minute < 3; minute += 1) await page.clock.fastForward(60_000);
    await expect(page.getByTestId("feed-last-loaded")).toContainText("4 minutes ago");
    expect(await page.getByTestId("feed-status").innerText()).toBe(announced);
    expect(await page.evaluate(() => (window as unknown as { __liveChanges: string[] }).__liveChanges)).toEqual([]);
  });

  test("a newer ask replacing one still in flight is not a failure: nothing is announced, and the newer answer is shown", async ({ page }) => {
    await stubFeed(page, [feedOf(4)]);
    await page.clock.install({ time: new Date("2026-10-01T12:00:00Z") });
    await choose(page, MILEPOST);

    await openResident(page, "/en", 390);
    await ready(page);
    const held = await holdFeed(page);

    // The first ask hangs. No time passes, so the timeout has not fired.
    await setVisibility(page, "hidden");
    await setVisibility(page, "visible");
    await expect.poll(() => held.length).toBe(1);
    // A second ask replaces it while it is still in flight.
    await setVisibility(page, "hidden");
    await setVisibility(page, "visible");
    await expect.poll(() => held.length).toBe(2);
    await expect(page.getByTestId("feed-failed")).toHaveCount(0);

    // The newer ask is answered; the replaced one's answer, if it ever came, would be ignored.
    await held[1].fulfill({ json: feedOf(5, { buildings: { [MILEPOST]: { status: "active" } } }) });
    await expect(statusOf(page, `home-building-${MILEPOST}`)).toHaveText("Active problem");
    await expect(page.getByTestId("feed-failed")).toHaveCount(0);
  });

  test("coming back to the tab after more than 2 minutes says nothing is wrong while the check runs, and nothing after it answers", async ({ page }) => {
    await stubFeed(page, [feedOf(4)]);
    await page.clock.install({ time: new Date("2026-10-01T12:00:00Z") });
    await choose(page, MILEPOST);

    await openResident(page, "/en", 390);
    await ready(page);
    const held = await holdFeed(page);

    await setVisibility(page, "hidden");
    await page.clock.fastForward(5 * 60_000);
    await setVisibility(page, "visible");
    await expect.poll(() => held.length).toBe(1);

    // The check is running, the feed on screen is 5 minutes old: no note, not even once.
    await expect(page.getByTestId("feed-failed")).toHaveCount(0);
    await expect(page.getByTestId("feed-last-loaded")).toHaveCount(0);
    await held[0].fulfill({ json: feedOf(5, { buildings: { [MILEPOST]: { status: "resolved" } } }) });
    await expect(statusOf(page, `home-building-${MILEPOST}`)).toHaveText("Resolved");
    await expect(page.getByTestId("feed-failed")).toHaveCount(0);
  });

  test("becoming visible starts the 60 seconds over: the next tick does not replace, and so cancel, the ask it made", async ({ page }) => {
    await stubFeed(page, [feedOf(4)]);
    await page.clock.install({ time: new Date("2026-10-01T12:00:00Z") });
    await choose(page, MILEPOST);

    await openResident(page, "/en", 390);
    await ready(page);
    const held = await holdFeed(page);

    // 50 seconds in, the page becomes visible and asks; that ask is slow.
    await page.clock.fastForward(50_000);
    await setVisibility(page, "hidden");
    await setVisibility(page, "visible");
    await expect.poll(() => held.length).toBe(1);

    // The old tick would be at 60 seconds, 10 from now. With the 60 seconds started over it is at 110, so at 65 there is still one ask.
    await page.clock.fastForward(15_000);
    await roundTrip(page);
    expect(held).toHaveLength(1);
    await expect(page.getByTestId("feed-failed")).toHaveCount(0);

    await held[0].fulfill({ json: feedOf(5, { buildings: { [MILEPOST]: { status: "active" } } }) });
    await expect(statusOf(page, `home-building-${MILEPOST}`)).toHaveText("Active problem");
    await expect(page.getByTestId("feed-failed")).toHaveCount(0);
  });

  test("polls nothing while the page is hidden, and asks once, straight away, when it is visible again", async ({ page }) => {
    const requests = countFeedRequests(page);
    await stubFeed(page, [feedOf(1)]);
    await page.clock.install({ time: new Date("2026-10-01T12:00:00Z") });
    await choose(page, MILEPOST);

    await openResident(page, "/en", 390);
    await ready(page);
    expect(requests.count()).toBe(1);

    await setVisibility(page, "hidden");
    await page.clock.fastForward(180_000);
    await requests.settled();
    expect(requests.count()).toBe(1);

    await setVisibility(page, "visible");
    await expect.poll(requests.count).toBe(2);
    await requests.settled();
    expect(requests.count()).toBe(2);
  });
});

// Owner decisions 36 and 37: the short 911 notice (the shared inline block, the catalog's x01.short) is the last item on
// home, after the link to what the resident has told the CVH, in every state of the screen. `toContainText("911")` would
// prove nothing: the badge is aria-hidden decoration that always says 911, so the sentence is what is asserted.
test.describe("the short 911 notice on home", () => {
  const SHORT = "Not an emergency service. In danger? Call 911.";

  const expectLast = async (page: Page) => {
    const notice = page.locator('[data-component="not-911"]');
    await expect(notice).toHaveCount(1);
    await expect(notice).toHaveAttribute("data-variant", "inline");
    await expect(notice.locator("p")).toHaveText(SHORT);
    // The last child of the home content, directly after the link to what the resident has told the CVH.
    const order = await page.evaluate(() => {
      const content = document.querySelector('[data-testid="home-now"]')!.firstElementChild!;
      const children = [...content.children];
      const describe = (element: Element | undefined) => element?.getAttribute("data-component") ?? element?.getAttribute("data-testid") ?? element?.tagName ?? null;
      return { last: describe(children.at(-1)), before: describe(children.at(-2)), choicesLink: children.at(-2)?.matches('[data-testid="choices-link"]') ?? false };
    });
    expect(order).toEqual({ last: "not-911", before: "choices-link", choicesLink: true });
  };

  test("is the last item with chosen buildings and a feed that answered", async ({ page }) => {
    await stubFeed(page, [feedOf(1, { buildings: { [MILEPOST]: { status: "active" } } })]);
    await choose(page, MILEPOST);

    await openResident(page, "/en", 390);
    await ready(page);

    await expectLast(page);
  });

  test("is the last item with no chosen building", async ({ page }) => {
    await stubFeed(page, [feedOf(1)]);
    await choose(page);

    await openResident(page, "/en", 390);
    await ready(page);
    await expect(page.getByTestId("home-invite")).toBeVisible();

    await expectLast(page);
  });

  test("is the last item when the feed could not be read, with or without chosen buildings", async ({ page }) => {
    await stubFeed(page, ["unavailable"]);
    await choose(page, MILEPOST);

    await openResident(page, "/en", 390);
    await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "failed");
    await expect(page.getByTestId("feed-failed")).toBeVisible();
    await expectLast(page);

    await page.evaluate((value) => localStorage.setItem("cvh.choices", value), JSON.stringify({ v: 1, lang: "en", welcomed: true, buildings: [] }));
    await page.reload();
    await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "failed");
    await expect(page.getByTestId("home-invite")).toBeVisible();
    await expectLast(page);
  });
});

// AD-3: nothing the resident chose leaves the phone. Every request home makes is the same one every resident makes.
test.describe("what leaves the phone", () => {
  const SAVED = {
    v: 1,
    lang: "en",
    welcomed: true,
    groups: ["seniors", "newcomers"],
    buildings: [MILEPOST, OVERLEA],
    floors: [FLOOR.milepost2, FLOOR.overlea1],
    muted: ["zz-muted-topic"],
    basic: true,
  };
  const SECRETS = [MILEPOST, OVERLEA, FLOOR.milepost2, FLOOR.overlea1, "seniors", "newcomers", "zz-muted-topic", "cvh.choices", "4 Milepost", "10 Overlea"];

  test("no saved choice is in any request home makes, however often it polls: only GET /api/feed?lang= and the building list, with no cookie", async ({ page }) => {
    await stubFeed(page, [feedOf(1, { buildings: { [MILEPOST]: { status: "active" } } })]);
    await page.clock.install({ time: new Date("2026-10-01T12:00:00Z") });
    await seedChoices(page, JSON.stringify(SAVED));
    const pending: Promise<{ method: string; url: string; headers: string; body: string }>[] = [];
    page.context().on("request", (request: Request) => {
      pending.push(request.allHeaders().then((headers) => ({ method: request.method(), url: request.url(), headers: JSON.stringify(headers), body: request.postData() ?? "" })));
    });

    for (const path of ["/en", "/ur"]) {
      await openResident(page, path, 390);
      await ready(page);
      for (let minute = 0; minute < 3; minute += 1) await page.clock.fastForward(60_000);
      await page.waitForLoadState("networkidle");
    }
    // The resident really did have those buildings on screen.
    await expect(page.getByTestId(`home-building-${MILEPOST}`)).toBeVisible();

    const seen = await Promise.all(pending);
    expect(seen.length).toBeGreaterThan(10);
    for (const request of seen) {
      const text = `${request.url}\n${request.headers}\n${request.body}`;
      for (const secret of SECRETS) expect(text, `${request.method} ${request.url} carries ${secret}`).not.toContain(secret);
    }
    const origin = new URL(page.url()).origin;
    const data = seen.filter((request) => new URL(request.url).origin === origin && new URL(request.url).pathname.startsWith("/api/"));
    const feeds = data.filter((request) => new URL(request.url).pathname === "/api/feed");
    // 1 first ask + 3 polls, in each of the two languages.
    expect(feeds.length).toBeGreaterThanOrEqual(8);
    for (const request of data) {
      expect(["/api/feed", "/api/buildings"]).toContain(new URL(request.url).pathname);
      expect(request.method).toBe("GET");
      expect(request.body).toBe("");
      expect(JSON.parse(request.headers)).not.toHaveProperty("cookie");
    }
    for (const request of feeds) expect(new URL(request.url).search).toMatch(/^\?lang=(en|ur)$/);
    for (const request of data.filter((one) => new URL(one.url).pathname === "/api/buildings")) expect(new URL(request.url).search).toBe("");
    // Nothing goes to another site, and the phone still holds all of it.
    expect(seen.filter((request) => !request.url.startsWith("data:") && new URL(request.url).origin !== origin)).toEqual([]);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cvh.choices")!).buildings)).toEqual([MILEPOST, OVERLEA]);
  });

  test("two residents with different choices make exactly the same feed request", async ({ page }) => {
    await stubFeed(page, [feedOf(1)]);
    const lines: string[] = [];
    page.on("request", async (request) => {
      if (new URL(request.url()).pathname === "/api/feed") lines.push(`${request.method()} ${request.url()} ${JSON.stringify(await request.allHeaders())} ${request.postData() ?? ""}`);
    });
    await seedChoices(page, JSON.stringify({ v: 1, lang: "en", welcomed: true, buildings: [MILEPOST] }));
    await openResident(page, "/en", 390);
    await ready(page);
    await expect(page.getByTestId(`home-building-${MILEPOST}`)).toBeVisible();

    // The same phone, now with other choices.
    await page.evaluate((value) => localStorage.setItem("cvh.choices", value), JSON.stringify({ v: 1, lang: "en", welcomed: true, buildings: [OVERLEA, BUILDINGS[1].rsn], floors: [FLOOR.overlea1] }));
    await page.reload();
    await ready(page);
    await expect(page.getByTestId(`home-building-${OVERLEA}`)).toBeVisible();
    await expect.poll(() => lines.length).toBe(2);

    expect(lines[0]).toEqual(lines[1]);
    expect(lines[0]).toMatch(/^GET http:\/\/localhost:\d+\/api\/feed\?lang=en /);
  });
});

// Baseline screenshots (S02.11): the home screen with chosen buildings, and with none, in English and Urdu at 390 and 1280.
const STATES = {
  buildings: { choose: [OVERLEA, MILEPOST], feed: feedOf(7, { buildings: { [MILEPOST]: { status: "active", verified: false }, [OVERLEA]: { status: "none" } }, neighbourhoods: { TP: { status: "active", verified: false } } }) },
  neighbourhood: { choose: [] as string[], feed: feedOf(7, { neighbourhoods: { FP: { status: "in_progress" } } }) },
} as const;

for (const language of ["en", "ur"] as const) {
  for (const [state, setup] of Object.entries(STATES)) {
    for (const width of [390, 1280] as const) {
      test(`${language} ${state} at ${width}px has no horizontal scrolling and matches its baseline screenshot`, async ({ page }) => {
        await stubFeed(page, [setup.feed]);
        await choose(page, ...setup.choose);

        await openResident(page, `/${language}`, width);
        await ready(page);
        await expect(page.getByTestId("first-run-gate")).toHaveAttribute("data-state", "ready");
        await page.waitForLoadState("networkidle");

        const overflow = await page.evaluate(() => ({
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          main: document.querySelector("main")!.scrollWidth - document.querySelector("main")!.clientWidth,
        }));
        expect(overflow).toEqual({ page: 0, main: 0 });
        await expectBaseline(page, `home-${state}-${language}-${width}.png`);
      });
    }
  }
}
