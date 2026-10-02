import { expect, test, type Request } from "@playwright/test";
import { BUILDINGS, FLOOR, seedChoices, stubBuildingList } from "./choices-fixture";
import { openResident } from "./helpers";

// S02.03, AD-3: the saved selection stays on the phone. A resident with saved choices goes through every screen of the
// epic so far, and no request carries what was saved: not the buildings or floors, the groups, the muted topics or basic
// mode, in the URL, the headers or the body. Requests for public content are allowed (the building list is one).

const BUILDING_A = BUILDINGS[0].rsn;
const BUILDING_B = BUILDINGS[3].rsn;
const SAVED = {
  v: 1,
  lang: "en",
  welcomed: true,
  groups: ["seniors", "newcomers"],
  buildings: [BUILDING_A, BUILDING_B],
  floors: [FLOOR.milepost2, FLOOR.overlea1],
  // Fields later stories add: they are the resident's too.
  muted: ["zz-muted-topic"],
  basic: true,
};

const SECRETS = [BUILDING_A, BUILDING_B, FLOOR.milepost2, FLOOR.overlea1, "seniors", "newcomers", "zz-muted-topic", "cvh.choices", "mutedTopics"];

type Seen = { method: string; url: string; headers: string; body: string };

test("no request carries the saved selection, and the only data requests are the same ones every visitor makes", async ({ page }) => {
  await stubBuildingList(page);
  await seedChoices(page, JSON.stringify(SAVED));
  const pending: Promise<Seen>[] = [];
  page.on("request", (request: Request) => {
    pending.push(request.allHeaders().then((headers) => ({ method: request.method(), url: request.url(), headers: JSON.stringify(headers), body: request.postData() ?? "" })));
  });

  // Every screen of the epic, as a returning resident with saved choices, and the first-run steps again.
  for (const path of ["/en", "/en/choices", "/en/choices/groups", "/en/choices/place", "/en/choices/language", "/en/welcome", "/en/welcome/groups", "/en/welcome/place", "/ur/choices", "/en/map", "/en/terms"]) {
    await openResident(page, path, 390);
    await page.waitForLoadState("networkidle");
  }
  // And the actions: change groups, pick another building, remove one, clear nothing.
  await openResident(page, "/en/choices/groups", 390);
  await page.getByTestId("group-families").check();
  await page.getByTestId("step-save").click();
  await page.waitForURL("**/en/choices");
  await page.getByTestId(`told-building-row-${BUILDING_A}`).getByRole("button", { name: /^Remove: / }).click();
  await page.waitForLoadState("networkidle");

  const seen = await Promise.all(pending);
  expect(seen.length).toBeGreaterThan(30);
  for (const request of seen) {
    const text = `${request.url}\n${request.headers}\n${request.body}`;
    for (const secret of SECRETS) expect(text, `${request.method} ${request.url} carries ${secret}`).not.toContain(secret);
  }

  // The data requests: only the building list, with no query and no body, the same for everyone.
  const own = seen.filter((request) => new URL(request.url).origin === new URL(page.url()).origin);
  const data = own.filter((request) => new URL(request.url).pathname.startsWith("/api/"));
  expect(data.length).toBeGreaterThan(0);
  for (const request of data) {
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe("/api/buildings");
    expect(new URL(request.url).search).toBe("");
    expect(request.body).toBe("");
    expect(JSON.parse(request.headers)).not.toHaveProperty("cookie");
  }
  // Nothing leaves for another site.
  expect(seen.filter((request) => !request.url.startsWith("data:") && new URL(request.url).origin !== new URL(page.url()).origin)).toEqual([]);
  // And the phone still holds all of it.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cvh.choices")!).muted)).toEqual(["zz-muted-topic"]);
});

test("a visitor with nothing saved makes the same building list request", async ({ page }) => {
  await stubBuildingList(page);
  await seedChoices(page, JSON.stringify({ v: 1, welcomed: true }));
  const lists: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/buildings") lists.push(`${request.method()} ${request.url()}`);
  });

  await openResident(page, "/en", 390);
  await expect(page.getByTestId("first-run-gate")).toHaveAttribute("data-state", "ready");
  await expect.poll(() => lists.length).toBe(1);

  expect(lists[0]).toMatch(/^GET http:\/\/localhost:\d+\/api\/buildings$/);
});
