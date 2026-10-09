import { expect, test, type Request } from "@playwright/test";
import { BUILDINGS, FLOOR, seedChoices, stubBuildingList } from "./choices-fixture";
import { newServer, stubDirectory } from "./directory-fixture";
import { openResident } from "./helpers";
import { expectUsageRequest, isUsageRequest } from "./usage-fixture";

// S02.06, AD-3: the saved choices stay on the phone. A resident with saved choices browses and filters the directory,
// and no request carries what was saved: not the buildings or floors, the groups, the muted topics or basic mode, nor the
// filters they applied or the provider they looked at, in the query, the headers or the body. The one place a provider's id
// appears is the path of the page itself (/en/directory/P101 is the address of that provider's page, as any page's address
// names the page): no API request, and no request for data, names a provider or a filter. The only requests for data are
// the ones every visitor makes: the manifest, the listing file of the page language, and the building list.

const BUILDING = BUILDINGS[3].rsn;
const SAVED = {
  v: 1,
  lang: "ur",
  welcomed: true,
  groups: ["seniors", "newcomers"],
  buildings: [BUILDING],
  floors: [FLOOR.overlea1],
  muted: ["zz-muted-topic"],
  basic: true,
};
const SECRETS = [BUILDING, FLOOR.overlea1, "seniors", "newcomers", "zz-muted-topic", "cvh.choices", "mutedTopics"];

type Seen = { method: string; url: string; headers: string; body: string };

test("no request carries the saved selection, the filters applied or the provider opened, and the only data requests are the ones every visitor makes", async ({ page }) => {
  await stubBuildingList(page);
  const server = newServer(7);
  await stubDirectory(page, server);
  await seedChoices(page, JSON.stringify(SAVED));
  const pending: Promise<Seen>[] = [];
  page.context().on("request", (request: Request) => {
    pending.push(request.allHeaders().then((headers) => ({ method: request.method(), url: request.url(), headers: JSON.stringify(headers), body: request.postData() ?? "" })));
  });

  for (const path of ["/en/directory", "/ur/directory", "/en/directory/P101", "/ur/directory/P104"]) {
    await openResident(page, path, 390);
    await page.waitForLoadState("networkidle");
  }
  // And the actions: filter by every kind of filter, open a listing, go back, and the Urdu list.
  await openResident(page, "/en/directory", 390);
  await page.getByTestId("filters-toggle").click();
  await page.getByTestId("filter-category-food").check();
  await page.getByTestId("filter-neighbourhood-TP").check();
  await page.getByTestId("filter-emergency").check();
  await page.getByTestId("provider-link").first().click();
  await page.getByTestId("back-to-directory").click();
  await page.getByTestId("clear-all").click();
  await openResident(page, "/ur/directory", 390);
  await page.waitForLoadState("networkidle");

  const seen = await Promise.all(pending);
  expect(seen.length).toBeGreaterThan(20);
  const filterTerms = ["category-food", "category:food", "neighbourhood", "emergency=", "P101", "P104"];
  for (const request of seen) {
    const text = `${request.url}\n${request.headers}\n${request.body}`;
    for (const secret of SECRETS) expect(text, `${request.method} ${request.url} carries ${secret}`).not.toContain(secret);
    // The URL of an API request never names a provider or a filter. A provider's id is in the path of its page (the document
    // request for /en/directory/P101), which is the page's own address and is not an API request.
    if (new URL(request.url).pathname.startsWith("/api/")) for (const term of filterTerms) expect(request.url, request.url).not.toContain(term);
  }

  const own = seen.filter((request) => new URL(request.url).origin === new URL(page.url()).origin);
  // S02.15: the usage events are the one other request, and each is the fixed message with none of the above in it.
  const usage = own.filter((request) => isUsageRequest(request.url));
  expect(usage.length).toBeGreaterThan(0);
  for (const request of usage) expectUsageRequest(request);
  const data = own.filter((request) => new URL(request.url).pathname.startsWith("/api/") && !isUsageRequest(request.url));
  expect(data.length).toBeGreaterThan(0);
  const allowed = [/^\/api\/directory\/manifest$/, /^\/api\/directory\/7\/(?:en|ur)\.json$/, /^\/api\/buildings$/];
  for (const request of data) {
    expect(request.method).toBe("GET");
    expect(allowed.some((pattern) => pattern.test(new URL(request.url).pathname)), request.url).toBe(true);
    expect(new URL(request.url).search).toBe("");
    expect(request.body).toBe("");
    expect(JSON.parse(request.headers)).not.toHaveProperty("cookie");
  }
  // Nothing leaves for another site.
  expect(seen.filter((request) => !request.url.startsWith("data:") && new URL(request.url).origin !== new URL(page.url()).origin)).toEqual([]);
  // And the phone still holds all of it.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cvh.choices")!).muted)).toEqual(["zz-muted-topic"]);
});

test("a visitor with nothing saved makes the same two release requests, and no building list request", async ({ page }) => {
  const server = newServer(7);
  await stubDirectory(page, server);
  const lists: string[] = [];
  page.context().on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/buildings") lists.push(request.url());
  });

  await openResident(page, "/en/directory", 390);
  await expect(page.getByTestId("directory-list")).toBeVisible();
  await page.waitForLoadState("networkidle");

  expect(server.requests).toEqual(["GET /api/directory/manifest", "GET /api/directory/7/en.json"]);
  expect(lists).toEqual([]);
});
