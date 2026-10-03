import axe from "axe-core";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import { newServer, stubDirectory, type DirectoryServer } from "./directory-fixture";
import { expectBaseline, openResident, waitForFonts } from "./helpers";

// S03.06: a resident asks a question (/{lang}/search) and sees the right listings. The release routes are answered by
// directory-fixture.ts and /api/search by the stub below (the resident server has no database and no embedding key here).
// Release 7 has five sample providers; P101 and P104 have an emergency role. The Urdu listing is machine translated.

const SECRET = "zq-marker-7f3a91-landlord";

type Reply = { status?: number; json?: unknown; headers?: Record<string, string>; abort?: boolean; delayMs?: number };
type Asked = { method: string; url: string; body: string; headers: Record<string, string> };

const answer = (change: { status?: "ok" | "no_clear_match" | "unavailable"; ids?: string[]; release?: number; lang?: string; emergency?: boolean } = {}) => ({
  v: 1,
  release_v: change.release ?? 7,
  query_lang: change.lang ?? "en",
  status: change.status ?? "ok",
  emergency_first: change.emergency ?? false,
  results: (change.status ?? "ok") === "ok" ? (change.ids ?? ["P104", "P101"]).map((provider_id, at) => ({ provider_id, score: 0.9 - at / 10 })) : [],
});

/** Answers POST /api/search with whatever `reply` says now; every request is recorded. */
async function stubSearch(page: Page, reply: { current: Reply }): Promise<Asked[]> {
  const asked: Asked[] = [];
  await page.context().route("**/api/search", async (route: Route) => {
    const request = route.request();
    asked.push({ method: request.method(), url: request.url(), body: request.postData() ?? "", headers: await request.allHeaders() });
    const r = reply.current;
    if (r.delayMs) await new Promise((resolve) => setTimeout(resolve, r.delayMs));
    if (r.abort) return route.abort("internetdisconnected");
    return route.fulfill({ status: r.status ?? 200, json: r.json, headers: { "Cache-Control": "no-store", ...(r.headers ?? {}) } });
  });
  return asked;
}

async function setUp(page: Page, options: { search?: "available" | "unavailable"; release?: number } = {}): Promise<{ server: DirectoryServer; reply: { current: Reply }; asked: Asked[] }> {
  const server = newServer(options.release ?? 7);
  server.search = options.search ?? "available";
  await stubDirectory(page, server);
  const reply = { current: { json: answer() } as Reply };
  const asked = await stubSearch(page, reply);
  return { server, reply, asked };
}

async function ask(page: Page, question: string) {
  await page.getByTestId("ask-input").fill(question);
  await page.getByTestId("ask-submit").click();
}

const ready = async (page: Page) => {
  await expect(page.getByTestId("ask-topics")).toBeVisible();
  await waitForFonts(page);
};

/** Grows the viewport to the whole page and compares it with the baseline. */
async function shot(page: Page, width: number, name: string) {
  await waitForFonts(page);
  const needed = await page.evaluate(() => {
    const main = document.querySelector("main")!;
    return Math.ceil(main.scrollHeight + document.documentElement.clientHeight - main.clientHeight);
  });
  await page.setViewportSize({ width, height: needed });
  await expectBaseline(page, name);
}

/** No serious or critical violation (NFR-N2) on what is on screen now. */
async function expectNoSeriousViolation(page: Page, state: string) {
  await waitForFonts(page);
  await page.addScriptTag({ content: axe.source });
  const found = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: typeof axe }).axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] });
    return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
  });
  expect(found, state).toEqual([]);
}

/** The test id of the element that has focus, or its tag when it has none. */
const focused = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("data-testid") ?? document.activeElement?.tagName ?? "none");

const listed = (page: Page) => page.locator("[data-testid=ask-results] > li > article").evaluateAll((cards) => cards.map((card) => card.getAttribute("data-provider-id")));

test("with search available the box and the topics show, with the 911 line; with search unavailable only the topics and the 911 line", async ({ page }) => {
  await setUp(page, { search: "available" });
  await openResident(page, "/en/search", 390);
  await ready(page);
  await expect(page.getByTestId("ask-input")).toBeVisible();
  await expect(page.getByTestId("ask-input")).toHaveAttribute("placeholder", "For example: my landlord wants me to move out");
  await expect(page.getByTestId("ask-topic-food")).toHaveText("Food");
  // The prototype's X01_Not911 inline note, and the way to dial 911.
  await expect(page.locator('[data-component="not-911"][data-variant="inline"]')).toContainText("Not an emergency service. In danger? Call 911.");
  await expect(page.getByTestId("ask-911-link")).toHaveText("If someone is in danger, call 911.");
  await expect(page.getByTestId("ask-911-link")).toHaveAttribute("href", "tel:911");
  await shot(page, 390, "search-entry-en-390.png");
  await shot(page, 1280, "search-entry-en-1280.png");

  const other = await page.context().newPage();
  const server = newServer(7);
  server.search = "unavailable";
  await other.context().unroute(/\/api\/directory\//);
  await other.context().unroute("**/api/directory/manifest");
  await stubDirectory(other, server);
  await openResident(other, "/en/search", 390);
  await ready(other);
  await expect(other.getByTestId("ask-form")).toHaveCount(0);
  await expect(other.getByTestId("ask-topic-food")).toBeVisible();
  await expect(other.getByTestId("ask-911-link")).toHaveAttribute("href", "tel:911");
  await expect(other.locator('[data-component="not-911"][data-variant="inline"]')).toHaveCount(1);
  await shot(other, 390, "search-unavailable-en-390.png");
});

test("a topic button opens the directory with that topic applied, and nothing about it in the address", async ({ page }) => {
  await setUp(page);
  await openResident(page, "/en/search", 390);
  await ready(page);
  await page.getByTestId("ask-topic-health").click();
  await expect(page).toHaveURL(/\/en\/directory$/);
  await expect(page.getByTestId("chip-category:health")).toBeVisible();
  await expect(page.getByTestId("directory-list").locator("article")).toHaveCount(1);
});

test("results are the listings of the answer's release in the returned order, in an announced region, with the date and no server text", async ({ page }) => {
  const { asked } = await setUp(page);
  await openResident(page, "/en/search", 390);
  await ready(page);
  await ask(page, "I need food");

  await expect(page.getByTestId("ask-results")).toBeVisible();
  expect(await listed(page)).toEqual(["P104", "P101"]);
  await expect(page.getByTestId("ask-status")).toHaveAttribute("role", "status");
  await expect(page.getByTestId("ask-status")).toContainText('2 results for "I need food"');
  await expect(page.getByTestId("provider-P101").getByTestId("last-confirmed")).toHaveText("Last confirmed by the Hub September 30, 2026");
  await expect(page.getByTestId("provider-P101").locator("h2")).toHaveText("Thorncliffe Park Food Bank");
  await expect(page.getByTestId("ask-emergency-first")).toHaveCount(0);
  await expect(page.getByTestId("ask-shown-in")).toHaveCount(0);
  // The question went in the body of one POST, with the page language and the release the phone holds.
  expect(asked).toHaveLength(1);
  expect(asked[0].method).toBe("POST");
  expect(JSON.parse(asked[0].body)).toEqual({ q: "I need food", lang: "en", v: 7 });
  expect(new URL(asked[0].url).search).toBe("");
  await shot(page, 390, "search-results-en-390.png");
  await shot(page, 1280, "search-results-en-1280.png");
});

test("no text of the server is shown but ids and scores' listings: an answer with extra words shows none of them", async ({ page }) => {
  const { reply } = await setUp(page);
  const base = answer({ ids: ["P101"] });
  reply.current = { json: { ...base, message: "SERVER-WORDS-ONE", summary: "SERVER-WORDS-TWO", results: [{ ...base.results[0], title: "SERVER-WORDS-THREE", text: "SERVER-WORDS-FOUR" }] } };
  await openResident(page, "/en/search", 390);
  await ready(page);
  await ask(page, "food");
  await expect(page.getByTestId("ask-results")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("SERVER-WORDS");
});

test("one result is announced as one result", async ({ page }) => {
  const { reply } = await setUp(page);
  reply.current = { json: answer({ ids: ["P102"] }) };
  await openResident(page, "/en/search", 390);
  await ready(page);
  await ask(page, "a doctor");
  await expect(page.getByTestId("ask-status")).toContainText('1 result for "a doctor"');
});

test("emergency_first puts the shared 911 block above the results, once", async ({ page }) => {
  const { reply } = await setUp(page);
  reply.current = { json: answer({ emergency: true }) };
  await openResident(page, "/en/search", 390);
  await ready(page);
  await ask(page, "the power is out and it is very hot");
  await expect(page.getByTestId("ask-results")).toBeVisible();

  // One block above the results (the inline note at the end of the screen is the other variant).
  await expect(page.locator('[data-component="not-911"][data-variant="block"]')).toHaveCount(1);
  const order = await page.evaluate(() => {
    const block = document.querySelector('[data-component="not-911"][data-variant="block"]')!;
    const results = document.querySelector('[data-testid="ask-results"]')!;
    return Boolean(block.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
  await expect(page.locator('[data-component="not-911"][data-variant="block"]')).toContainText("The CVH is not an emergency service.");
  await shot(page, 390, "search-emergency-en-390.png");
});

test("no_clear_match with emergency_first shows one 911 block above the no-match state, with the topics, the Hub link and the 911 line", async ({ page }) => {
  const { reply } = await setUp(page);
  reply.current = { json: answer({ status: "no_clear_match", emergency: true }) };
  await openResident(page, "/en/search", 390);
  await ready(page);
  await ask(page, "the power is out and it is very hot");

  await expect(page.getByTestId("ask-none-title")).toBeVisible();
  await expect(page.getByTestId("ask-emergency-first")).toHaveCount(1);
  await expect(page.locator('[data-component="not-911"][data-variant="block"]')).toHaveCount(1);
  const above = await page.evaluate(() => {
    const block = document.querySelector('[data-testid="ask-emergency-first"]')!;
    const help = document.querySelector('[data-testid="ask-help"]')!;
    return Boolean(block.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(above).toBe(true);
  await expect(page.getByTestId("ask-topic-food")).toBeVisible();
  await expect(page.getByTestId("ask-help").getByTestId("hub-call")).toHaveAttribute("href", /^tel:\+1/);
  await expect(page.getByTestId("ask-911-link")).toBeVisible();
  await expect(page.getByTestId("ask-results")).toHaveCount(0);
});

test("no_clear_match shows the prototype's R-11: the topics, the Hub's number and the 911 line", async ({ page }) => {
  const { reply } = await setUp(page);
  reply.current = { json: answer({ status: "no_clear_match" }) };
  await openResident(page, "/en/search", 390);
  await ready(page);
  await ask(page, "something no listing covers");

  await expect(page.getByTestId("ask-none-title")).toHaveText("We could not find that yet");
  await expect(page.getByTestId("ask-status")).toContainText("We could not find that yet");
  await expect(page.getByTestId("ask-help").getByTestId("hub-call")).toHaveAttribute("href", /^tel:\+1/);
  await expect(page.getByTestId("ask-topics-title")).toHaveText("Choose a topic instead");
  await expect(page.getByTestId("ask-topic-food")).toBeVisible();
  await expect(page.getByTestId("ask-911-link")).toBeVisible();
  await expect(page.getByTestId("ask-results")).toHaveCount(0);
  await shot(page, 390, "search-no-match-en-390.png");
  await shot(page, 1280, "search-no-match-en-1280.png");
});

test("rate limiting (429 with Retry-After) and a failing server (503) show 'Search is busy', with the topics and the Hub's number", async ({ page }) => {
  const { reply, asked } = await setUp(page);
  await openResident(page, "/en/search", 390);
  await ready(page);

  reply.current = { status: 429, json: { error: { code: "rate_limited", message_key: "search.rate_limited" } }, headers: { "Retry-After": "600" } };
  await ask(page, "first");
  await expect(page.getByTestId("ask-busy-title")).toHaveText("Search is busy, try again in a few minutes");
  await expect(page.getByTestId("ask-help").getByTestId("hub-call")).toBeVisible();
  await expect(page.getByTestId("ask-topic-food")).toBeVisible();
  await shot(page, 390, "search-busy-en-390.png");
  // Told to wait, the phone does not ask again until it may.
  reply.current = { json: answer() };
  await page.getByTestId("ask-submit").click();
  await expect(page.getByTestId("ask-busy-title")).toBeVisible();
  expect(asked).toHaveLength(1);
  // Never the server's own words.
  await expect(page.locator("body")).not.toContainText("rate_limited");

  await page.reload();
  await ready(page);
  reply.current = { status: 503, json: { error: { code: "search_unavailable", message_key: "search.search_unavailable" } } };
  await ask(page, "second");
  await expect(page.getByTestId("ask-busy-title")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("search_unavailable");
});

test("an unavailable answer from the server hides the box and shows only the topics, never 'Search is busy'", async ({ page }) => {
  const { reply } = await setUp(page);
  await openResident(page, "/en/search", 390);
  await ready(page);
  reply.current = { json: answer({ status: "unavailable" }) };
  await ask(page, "third");
  await expect(page.getByTestId("ask-form")).toHaveCount(0);
  await expect(page.getByTestId("ask-busy-title")).toHaveCount(0);
  await expect(page.getByTestId("ask-help")).toHaveCount(0);
  await expect(page.getByTestId("ask-topic-food")).toBeVisible();
  await expect(page.getByTestId("ask-911-link")).toHaveAttribute("href", "tel:911");
  await expect(page.locator("body")).not.toContainText("Search is busy");
  // The box went from under the resident's focus: it is on the topics, not lost.
  expect(await focused(page)).toBe("ask-topics-title");
});

test("offline, a question gets 'Search needs signal' with the topics and the Hub's number, and topics still work from the kept listing", async ({ page }) => {
  const { reply, server } = await setUp(page);
  await openResident(page, "/en/search", 390);
  await ready(page);
  reply.current = { abort: true };
  await ask(page, "no signal here");

  await expect(page.getByTestId("ask-signal-title")).toHaveText("Search needs signal");
  await expect(page.getByTestId("ask-help").getByTestId("hub-call")).toBeVisible();
  await shot(page, 390, "search-signal-en-390.png");
  // The release files cannot be reached either (the page itself is served; offline page loads are S02.12's): the topic still works from the kept listing.
  server.manifestDown = true;
  await page.getByTestId("ask-topic-food").click();
  await expect(page).toHaveURL(/\/en\/directory$/);
  await expect(page.getByTestId("directory-list").locator("article")).toHaveCount(1);
});

test("when the client's release is older, the manifest is read again and the new release's file is loaded before results show; if that fails, 'being updated' and the topics", async ({ page }) => {
  const { server, reply } = await setUp(page, { release: 7 });
  await openResident(page, "/en/search", 390);
  await ready(page);
  expect(server.requests).toEqual(["GET /api/directory/manifest", "GET /api/directory/7/en.json"]);

  server.release = 8;
  reply.current = { json: answer({ release: 8, ids: ["P102"] }) };
  await ask(page, "a doctor");
  await expect(page.getByTestId("ask-results")).toBeVisible();
  expect(await listed(page)).toEqual(["P102"]);
  expect(server.requests.slice(2)).toEqual(["GET /api/directory/manifest", "GET /api/directory/8/en.json"]);

  // Release 9 cannot be downloaded: nothing of it is shown.
  server.release = 9;
  server.file = "fail";
  reply.current = { json: answer({ release: 9, ids: ["P101"] }) };
  await ask(page, "food again");
  await expect(page.getByTestId("ask-updating-title")).toHaveText("Search results are being updated, try again");
  await expect(page.getByTestId("ask-results")).toHaveCount(0);
  await expect(page.getByTestId("ask-topic-food")).toBeVisible();
  await expect(page.getByTestId("ask-help").getByTestId("hub-call")).toBeVisible();
  await shot(page, 390, "search-updating-en-390.png");
  // And with the manifest down too.
  server.manifestDown = true;
  await ask(page, "food once more");
  await expect(page.getByTestId("ask-updating-title")).toBeVisible();
});

test("a question in another language shows the listings in that language with a note; if its file cannot be had, the page language with the note", async ({ page }) => {
  const { server, reply } = await setUp(page);
  await openResident(page, "/en/search", 390);
  await ready(page);
  reply.current = { json: answer({ lang: "ur", ids: ["P101"] }) };
  await ask(page, "مجھے کھانا چاہیے");
  await expect(page.getByTestId("ask-results")).toBeVisible();
  await expect(page.getByTestId("ask-shown-in")).toHaveText("Shown in اردو");
  await expect(page.getByTestId("provider-P101").getByTestId("provider-services")).toContainText("مفت راشن");
  await expect(page.getByTestId("provider-P101").getByTestId("provider-services").locator("p")).toHaveAttribute("lang", "ur");
  // The Urdu listing is machine translated: the card says so, and offers the English original.
  await expect(page.getByTestId("provider-P101").getByTestId("machine-label")).toBeVisible();
  await expect(page.getByTestId("provider-P101").getByTestId("show-english")).toBeVisible();
  // The language's name inside the note is isolated, with its own language and direction.
  await expect(page.getByTestId("ask-shown-in").locator("bdi")).toHaveAttribute("lang", "ur");
  await expect(page.getByTestId("ask-shown-in").locator("bdi")).toHaveAttribute("dir", "rtl");
  expect(server.requests).toContain("GET /api/directory/7/ur.json");

  // Another visit, the Urdu file now cannot be had.
  await page.reload();
  await ready(page);
  await page.context().unroute(/\/api\/directory\/\d+\/[A-Za-z-]+\.json$/);
  await page.context().route(/\/api\/directory\/7\/ur\.json$/, (route) => route.fulfill({ status: 503, json: { v: 1, error: { code: "unavailable", message_key: "directory.unavailable" } } }));
  await page.context().route(/\/api\/directory\/7\/en\.json$/, async (route) => route.continue());
  await page.evaluate(() => localStorage.removeItem("cvh.directory.ur"));
  await ask(page, "مجھے کھانا چاہیے");
  await expect(page.getByTestId("ask-results")).toBeVisible();
  await expect(page.getByTestId("ask-shown-in")).toHaveText("Shown in English");
  await expect(page.getByTestId("provider-P101").getByTestId("provider-services")).toContainText("Free groceries");
});

test("the Urdu ask screen mirrors, and its results and states render", async ({ page }) => {
  const { reply } = await setUp(page);
  await openResident(page, "/ur/search", 390);
  await ready(page);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await shot(page, 390, "search-entry-ur-390.png");
  await shot(page, 1280, "search-entry-ur-1280.png");
  reply.current = { json: answer({ lang: "ur" }) };
  await ask(page, "کھانا");
  await expect(page.getByTestId("ask-results")).toBeVisible();
  await shot(page, 390, "search-results-ur-390.png");
  await shot(page, 1280, "search-results-ur-1280.png");
  reply.current = { json: answer({ status: "no_clear_match", lang: "ur" }) };
  await ask(page, "کچھ اور");
  await expect(page.getByTestId("ask-none-title")).toBeVisible();
  await shot(page, 390, "search-no-match-ur-390.png");
});

test("a question typed in Latin script on the Urdu screen does not run under the clear button", async ({ page }) => {
  await setUp(page);
  await openResident(page, "/ur/search", 390);
  await ready(page);
  await page.getByTestId("ask-input").fill("my landlord wants me to move out");
  await expect(page.getByTestId("ask-clear")).toBeVisible();
  // The button is beside the box, not over it: the two do not overlap, whatever the direction of the text.
  const [input, clear] = await Promise.all([page.getByTestId("ask-input").boundingBox(), page.getByTestId("ask-clear").boundingBox()]);
  const apart = input!.x + input!.width <= clear!.x + 0.5 || clear!.x + clear!.width <= input!.x + 0.5;
  expect(apart).toBe(true);
  await shot(page, 390, "search-latin-question-ur-390.png");
});

test("results in another language: the machine-translation label, axe and a screenshot, on the English page with Urdu results and the Urdu page with English results", async ({ page }) => {
  const { reply } = await setUp(page);
  await openResident(page, "/en/search", 390);
  await ready(page);
  reply.current = { json: answer({ lang: "ur", ids: ["P101", "P104"] }) };
  await ask(page, "مجھے کھانا چاہیے");
  await expect(page.getByTestId("ask-results")).toBeVisible();
  await expect(page.getByTestId("ask-shown-in")).toHaveText("Shown in اردو");
  await expect(page.getByTestId("provider-P101").getByTestId("machine-label")).toBeVisible();
  await expectNoSeriousViolation(page, "en page, ur results");
  await shot(page, 390, "search-results-other-en-390.png");

  await openResident(page, "/ur/search", 390);
  await ready(page);
  reply.current = { json: answer({ lang: "en", ids: ["P101", "P104"] }) };
  await ask(page, "I need food");
  await expect(page.getByTestId("ask-results")).toBeVisible();
  await expect(page.getByTestId("ask-shown-in")).toBeVisible();
  await expect(page.getByTestId("ask-shown-in").locator("bdi").last()).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("provider-P101").getByTestId("machine-label")).toHaveCount(0);
  await expectNoSeriousViolation(page, "ur page, en results");
  await shot(page, 390, "search-results-other-ur-390.png");
});

test("submitting keeps focus on the button while the question is out, then moves it to the heading of the outcome", async ({ page }) => {
  const { reply, asked } = await setUp(page);
  await openResident(page, "/en/search", 390);
  await ready(page);

  reply.current = { json: answer(), delayMs: 1500 };
  await page.getByTestId("ask-input").fill("food");
  await page.getByTestId("ask-submit").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("ask-searching")).toBeVisible();
  // Inert, not disabled: it still has focus, and a second click asks nothing.
  await expect(page.getByTestId("ask-submit")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("ask-submit")).toHaveJSProperty("disabled", false);
  await page.getByTestId("ask-submit").dispatchEvent("click");
  expect(await focused(page)).toBe("ask-submit");
  await expect(page.getByTestId("ask-results-title")).toBeVisible();
  expect(await focused(page)).toBe("ask-results-title");
  expect(asked).toHaveLength(1);

  reply.current = { json: answer({ status: "no_clear_match" }) };
  await ask(page, "nothing like it");
  await expect(page.getByTestId("ask-none-title")).toBeVisible();
  expect(await focused(page)).toBe("ask-none-title");

  reply.current = { status: 503, json: { error: { code: "search_unavailable", message_key: "search.search_unavailable" } } };
  await ask(page, "once more");
  await expect(page.getByTestId("ask-busy-title")).toBeVisible();
  expect(await focused(page)).toBe("ask-busy-title");

  reply.current = { abort: true };
  await ask(page, "and again");
  await expect(page.getByTestId("ask-signal-title")).toBeVisible();
  expect(await focused(page)).toBe("ask-signal-title");
});

// AD-3, FR-D2-Q: the question is sent only to /api/search, in the body of a POST. It is in no address, header or other
// request, not in any storage of the phone, in no cookie, and in no console message.
test("the question is sent only to /api/search and kept nowhere on the phone", async ({ page }) => {
  const { reply, asked } = await setUp(page);
  const seen: Promise<{ method: string; url: string; headers: string; body: string }>[] = [];
  page.context().on("request", (request: Request) => {
    seen.push(request.allHeaders().then((headers) => ({ method: request.method(), url: request.url(), headers: JSON.stringify(headers), body: request.postData() ?? "" })));
  });
  const consoleText: string[] = [];
  page.on("console", (message) => consoleText.push(message.text()));
  page.on("pageerror", (error) => consoleText.push(String(error)));

  await openResident(page, "/en/search", 390);
  await ready(page);
  await ask(page, SECRET);
  await expect(page.getByTestId("ask-results")).toBeVisible();
  // Results for it, a provider opened, and back; then a refused one and one without signal; the Enter key too.
  await page.getByTestId("provider-link").first().click();
  await page.waitForLoadState("networkidle");
  await page.goBack();
  await ready(page);
  reply.current = { status: 429, json: { error: { code: "rate_limited", message_key: "search.rate_limited" } }, headers: { "Retry-After": "1" } };
  await page.getByTestId("ask-input").fill(`${SECRET} two`);
  await page.getByTestId("ask-input").press("Enter");
  await expect(page.getByTestId("ask-busy-title")).toBeVisible();
  await page.reload();
  await ready(page);
  reply.current = { abort: true };
  await ask(page, `${SECRET} three`);
  await expect(page.getByTestId("ask-signal-title")).toBeVisible();
  // The browser's own address and history never hold it, and the box is not submitted as a form field.
  // A real form submission (requestSubmit, as the Enter key does) never falls back to a GET: the address, the history and its state are untouched.
  await page.getByTestId("ask-input").fill(SECRET);
  const before = { url: page.url(), length: await page.evaluate(() => history.length) };
  await page.getByTestId("ask-input").evaluate((input) => (input as HTMLTextAreaElement).form!.requestSubmit());
  await expect(page.getByTestId("ask-signal-title")).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(page.url()).toBe(before.url);
  expect(await page.evaluate(() => history.length)).toBe(before.length);
  expect(await page.evaluate(() => JSON.stringify(history.state))).not.toContain("zq-marker");
  expect(page.url()).not.toContain("zq-marker");
  expect(decodeURIComponent(page.url())).not.toContain(SECRET);
  expect(await page.getByTestId("ask-input").evaluate((input) => (input as HTMLTextAreaElement).name)).toBe("");

  const requests = await Promise.all(seen);
  const own = new URL(page.url()).origin;
  const carrying = requests.filter((request) => `${request.url}\n${request.headers}\n${request.body}`.includes(SECRET));
  // Every request that carries it is the POST to /api/search, and only its body does.
  expect(carrying.length).toBeGreaterThan(0);
  for (const request of carrying) {
    expect(request.method).toBe("POST");
    expect(request.url).toBe(`${own}/api/search`);
    expect(request.url).not.toContain(SECRET);
    expect(request.headers).not.toContain(SECRET);
    expect(request.body).toContain(SECRET);
    expect(JSON.parse(request.headers)).not.toHaveProperty("cookie");
  }
  expect(asked.every((a) => a.method === "POST" && !a.url.includes("?"))).toBe(true);
  // Nothing leaves for another site.
  expect(requests.filter((request) => !request.url.startsWith("data:") && new URL(request.url).origin !== own)).toEqual([]);

  const stored = await page.evaluate(async () => {
    const dump: string[] = [];
    for (const area of [localStorage, sessionStorage]) for (let i = 0; i < area.length; i += 1) dump.push(`${area.key(i)}=${area.getItem(area.key(i)!)}`);
    const dbs = (await indexedDB.databases?.()) ?? [];
    dump.push(JSON.stringify(dbs));
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      dump.push(...(await cache.keys()).map((request) => request.url));
    }
    dump.push(document.cookie);
    return dump.join("\n");
  });
  expect(stored).not.toContain("zq-marker");
  expect(await page.context().cookies()).toEqual([]);
  expect(consoleText.join("\n")).not.toContain("zq-marker");
});

// NFR-N2: no serious or critical violation in en, ur and ps, in normal and basic mode (the basic-mode switch is S02.14: here
// the same `data-basic` the tokens read is set), at rest and with each outcome on screen.
for (const lang of ["en", "ur", "ps"] as const) {
  for (const basic of [false, true]) {
    test(`axe finds no serious or critical violation: ${lang}, ${basic ? "basic" : "normal"} mode`, async ({ page }) => {
      const { reply } = await setUp(page);
      await openResident(page, `/${lang}/search`, 390);
      await ready(page);
      if (basic) await page.evaluate(() => document.documentElement.setAttribute("data-basic", "true"));
      const check = (state: string) => expectNoSeriousViolation(page, state);
      await check("entry");
      reply.current = { json: answer({ emergency: true, lang }) };
      await ask(page, "question");
      await expect(page.getByTestId("ask-results")).toBeVisible();
      await check("results");
      reply.current = { json: answer({ status: "no_clear_match", lang }) };
      await ask(page, "question two");
      await expect(page.getByTestId("ask-none-title")).toBeVisible();
      await check("no clear match");
      reply.current = { abort: true };
      await ask(page, "question three");
      await expect(page.getByTestId("ask-signal-title")).toBeVisible();
      await check("no signal");
    });
  }
}

test("the controls are at least 44 px", async ({ page }) => {
  const { reply } = await setUp(page);
  await openResident(page, "/en/search", 320);
  await ready(page);
  await page.getByTestId("ask-input").fill("food");
  const heights = await page.evaluate(() => [...document.querySelectorAll("main button, main a")].filter((el) => el.getBoundingClientRect().width > 0).map((el) => Math.round(el.getBoundingClientRect().height)));
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
  reply.current = { json: answer() };
  await page.getByTestId("ask-submit").click();
  await expect(page.getByTestId("ask-results")).toBeVisible();
  const afterHeights = await page.evaluate(() => [...document.querySelectorAll("main button, main a")].filter((el) => el.getBoundingClientRect().width > 0).map((el) => Math.round(el.getBoundingClientRect().height)));
  expect(Math.min(...afterHeights)).toBeGreaterThanOrEqual(44);
});
