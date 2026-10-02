import { expect, test, type Page } from "@playwright/test";
import { stubBuildingList } from "./choices-fixture";
import { newServer, stubDirectory, type DirectoryServer } from "./directory-fixture";
import { expectBaseline, openResident, waitForFonts } from "./helpers";

// S02.06: a resident browses and filters the directory (/{lang}/directory, /{lang}/directory/{id}). The release routes
// are answered by directory-fixture.ts (the resident server has no database in these tests): release 7 has five sample
// providers; P101 and P104 have an emergency role. The listing file says which neighbourhoods each provider is in (the
// Hub's reviewed list): P101 and P104 are in Thorncliffe Park, P102 and P105 in Flemingdon Park, P103 in neither.
// The Urdu listing is machine translated, except P105's services, which are English with translation.unavailable.
// Every fixture date is on or before 2026-10-01.


async function setUp(page: Page, release = 7): Promise<DirectoryServer> {
  const server = newServer(release);
  await stubDirectory(page, server);
  return server;
}

const listed = (page: Page) => page.locator("[data-testid=directory-list] > li > article").evaluateAll((cards) => cards.map((card) => card.getAttribute("data-provider-id")));
/** The list is drawn after the phone has the release file, so its text may need font files the first paint did not. */
async function waitForList(page: Page) {
  await expect(page.getByTestId("directory-list")).toBeVisible();
  await waitForFonts(page);
}

async function openFilters(page: Page) {
  if ((await page.getByTestId("filters-toggle").getAttribute("aria-expanded")) !== "true") await page.getByTestId("filters-toggle").click();
  await expect(page.getByTestId("filter-panel")).toBeVisible();
}

/** Waits for the fonts, grows the viewport to the whole page and compares it with the baseline. */
async function shot(page: Page, width: number, name: string) {
  await waitForFonts(page);
  await showWholePage(page, width);
  await expectBaseline(page, name);
}

/** Grows the viewport to the whole page, so the baseline shows every card, not the first screen. */
async function showWholePage(page: Page, width: number) {
  const needed = await page.evaluate(() => {
    const main = document.querySelector("main")!;
    return Math.ceil(main.scrollHeight + document.documentElement.clientHeight - main.clientHeight);
  });
  await page.setViewportSize({ width, height: needed });
}

test("lists every published provider once, each with its categories, contacts, services, emergency role and last-confirmed date", async ({ page }) => {
  await setUp(page);
  await openResident(page, "/en/directory", 390);
  await waitForList(page);

  expect(await listed(page)).toEqual(["P105", "P103", "P102", "P104", "P101"]);
  await expect(page.getByTestId("directory-count")).toHaveText("5 services");
  const food = page.getByTestId("provider-P101");
  await expect(food.locator("h2")).toHaveText("Thorncliffe Park Food Bank");
  await expect(food.locator(".dir-tag").first()).toHaveText("Food");
  await expect(food.getByTestId("provider-services")).toContainText("Free groceries every Tuesday and Friday");
  await expect(food.getByTestId("provider-contact").getByTestId("provider-call")).toHaveAttribute("href", "tel:+14165550101");
  await expect(food.getByTestId("provider-contact").getByTestId("provider-call")).toContainText("(416) 555-0101");
  await expect(food.getByTestId("emergency-role")).toHaveText("Hands out ready-to-eat food and water during a long power cut.");
  await expect(food.getByTestId("last-confirmed")).toHaveText("Last confirmed by the Hub September 30, 2026");
  // The English page has nothing in a language it was not translated into.
  await expect(page.getByTestId("directory-unavailable-note")).toHaveCount(0);
  await expect(page.getByTestId("machine-label")).toHaveCount(0);
});

test("a detail the file does not give reads Not known, never a blank", async ({ page }) => {
  await setUp(page);
  await openResident(page, "/en/directory", 390);
  await waitForList(page);

  const clinic = page.getByTestId("provider-P103");
  await expect(clinic.getByTestId("provider-contact")).toHaveText("Not known");
  await expect(clinic.getByTestId("provider-emergency")).toHaveText("Not known");
  await expect(clinic.getByTestId("provider-services")).not.toHaveText("");
  // Not known is a dashed ring and italics, so it is never mistaken for a fact.
  const look = await clinic.getByTestId("provider-contact").locator(".dir-unknown").evaluate((element) => ({
    font: getComputedStyle(element).fontStyle,
    ring: getComputedStyle(element.querySelector(".dir-unknown__mark")!).borderTopStyle,
  }));
  expect(look).toEqual({ font: "italic", ring: "dashed" });
});

test("reads only the published release files, and filtering makes no request at all", async ({ page }) => {
  const server = await setUp(page);
  const others: string[] = [];
  const all: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    all.push(`${request.method()} ${url.pathname}`);
    if (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/directory/")) others.push(`${request.method()} ${url.pathname}`);
  });
  await openResident(page, "/en/directory", 390);
  await waitForList(page);
  await page.waitForLoadState("networkidle");
  expect(server.requests).toEqual(["GET /api/directory/manifest", "GET /api/directory/7/en.json"]);

  // Filtering, narrowing, removing and clearing, and showing the English, happen on the phone: not one new request of any kind.
  const before = all.length;
  await openFilters(page);
  await page.getByTestId("filter-category-food").check();
  await page.getByTestId("filter-emergency").check();
  await page.getByTestId("filter-neighbourhood-FP").check();
  await page.getByTestId("filter-category-food").uncheck();
  await page.getByTestId("filters-apply").click();
  await page.getByTestId("remove-emergency").click();
  await page.getByTestId("clear-all").click();
  await expect(page.getByTestId("filter-bar")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(all.slice(before)).toEqual([]);
  expect(server.requests).toHaveLength(2);

  // Opening a provider's page and coming back asks the server which release is current, and nothing more: the file is kept.
  await page.getByTestId("provider-link").first().click();
  await page.getByTestId("back-to-directory").click();
  await page.waitForLoadState("networkidle");
  expect(server.requests.filter((r) => r.includes(".json"))).toEqual(["GET /api/directory/7/en.json"]);
  expect(others).toEqual([]);
});

test("filters narrow the list, the applied-filter bar shows each with a remove control, and Clear all restores the full list", async ({ page }) => {
  await setUp(page);
  await openResident(page, "/en/directory", 390);
  await waitForList(page);
  await expect(page.getByTestId("filter-bar")).toHaveCount(0);

  await openFilters(page);
  await page.getByTestId("filter-neighbourhood-TP").check();
  expect((await listed(page)).sort()).toEqual(["P101", "P104"]);
  await page.getByTestId("filter-emergency").check();
  await page.getByTestId("filter-category-community").check();
  expect(await listed(page)).toEqual(["P104"]);

  const bar = page.getByTestId("filter-bar");
  await expect(bar.locator("li")).toHaveText(["Public spaces×", "Thorncliffe Park×", "Helps in an emergency×"]);
  await expect(page.getByTestId("hidden-count")).toHaveText("4 places are hidden by these filters");
  await expect(page.getByTestId("directory-count")).toHaveText("1 service");

  // One filter off with its own remove control.
  await page.getByRole("button", { name: "Remove filter: Public spaces" }).click();
  await expect(bar.locator("li")).toHaveText(["Thorncliffe Park×", "Helps in an emergency×"]);
  expect((await listed(page)).sort()).toEqual(["P101", "P104"]);
  await expect(page.getByTestId("filter-category-community")).not.toBeChecked();

  await page.getByTestId("clear-all").click();
  await expect(bar).toHaveCount(0);
  expect(await listed(page)).toEqual(["P105", "P103", "P102", "P104", "P101"]);
  await expect(page.getByTestId("filter-neighbourhood-TP")).not.toBeChecked();
});

test("topics are alternatives and filters together all have to hold", async ({ page }) => {
  await setUp(page);
  await openResident(page, "/en/directory", 390);
  await waitForList(page);

  await openFilters(page);
  await page.getByTestId("filter-category-food").check();
  await page.getByTestId("filter-category-health").check();
  expect((await listed(page)).sort()).toEqual(["P101", "P102"]);
  await page.getByTestId("filter-neighbourhood-FP").check();
  expect(await listed(page)).toEqual(["P102"]);
  await expect(page.getByTestId("filters-apply")).toHaveText("Show 1 result");
});

test("a combination with no results shows the Hub's number, and Clear all brings the list back", async ({ page }) => {
  await setUp(page);
  await openResident(page, "/en/directory", 390);
  await waitForList(page);

  await openFilters(page);
  await page.getByTestId("filter-category-health").check();
  await page.getByTestId("filter-neighbourhood-TP").check();

  const empty = page.getByTestId("directory-empty");
  await expect(empty).toBeVisible();
  await expect(page.getByTestId("directory-list")).toHaveCount(0);
  await expect(empty.locator("h2")).toHaveText("We could not find that yet");
  await expect(page.getByTestId("hub-call")).toHaveText("Call (416) 421-8997");
  await expect(page.getByTestId("hub-call")).toHaveAttribute("href", "tel:+14164218997");
  await expect(page.getByTestId("filters-apply")).toHaveText("Apply (nothing matches yet)");

  // The inline 911 note is the last thing on the screen.
  const note = empty.getByRole("note");
  await expect(note).toHaveText("Not an emergency service. In danger? Call 911.");
  await expect(note).toHaveAttribute("data-testid", "inline-911");
  expect(await note.evaluate((element) => element.nextElementSibling === null && element.parentElement!.lastElementChild === element)).toBe(true);

  await page.getByTestId("empty-clear").click();
  await expect(empty).toHaveCount(0);
  expect(await listed(page)).toHaveLength(5);
});

test("How they can help shows the emergency role and names 911, on the list and on the provider's own page", async ({ page }) => {
  await setUp(page);
  await openResident(page, "/en/directory", 390);
  await waitForList(page);

  const card = page.getByTestId("provider-P104");
  await expect(card.getByTestId("how-they-help")).toContainText("How they can help");
  await expect(card.getByTestId("emergency-role")).toHaveText("Open as a cooling room during heat warnings. Not a medical service.");
  await expect(card.getByTestId("help-911")).toHaveText("If someone is in danger, call 911.");

  await card.getByTestId("provider-link").click();
  await expect(page).toHaveURL(/\/en\/directory\/P104$/);
  await expect(page.locator("main h1")).toHaveText("Overlea Cooling Room");
  await expect(page.getByTestId("how-they-help")).toContainText("How they can help");
  await expect(page.getByTestId("emergency-role")).toHaveText("Open as a cooling room during heat warnings. Not a medical service.");
  await expect(page.getByTestId("help-911")).toHaveText("If someone is in danger, call 911.");
  await expect(page.getByTestId("last-confirmed")).toHaveText("Last confirmed by the Hub September 28, 2026");
  // The provider page ends with the inline 911 note, after the provider.
  await expect(page.getByTestId("inline-911")).toHaveText("Not an emergency service. In danger? Call 911.");
  await expect(page.getByTestId("inline-911")).toHaveAttribute("role", "note");
  expect(await page.getByTestId("inline-911").evaluate((element) => element.previousElementSibling?.getAttribute("data-testid"))).toBe("provider-P104");
});

test("a provider page lists every number, link and address of the provider, and opens from its own address", async ({ page }) => {
  await setUp(page);
  await openResident(page, "/en/directory/P102", 390);

  await expect(page.locator("main h1")).toHaveText("Flemingdon Community Health Centre");
  const calls = page.getByTestId("provider-call");
  await expect(calls).toHaveText(["Call (416) 555-0102", "Call (416) 555-0103 (Ext 211)", "Call (613) 555-0104", "Call (647) 555-0105 (Spanish)"]);
  await expect(calls.nth(1)).toHaveAttribute("href", "tel:+14165550103");
  await expect(page.getByTestId("provider-email")).toHaveAttribute("href", "mailto:care@example.org");
  await expect(page.getByTestId("provider-web")).toHaveAttribute("href", "https://www.example.org/health");
  await expect(page.getByTestId("provider-web")).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.locator(".dir-card__address")).toHaveText("10 Gateway Blvd, North York, M3C 1H9");
  // The postal code is one piece: its space is a non-breaking space.
  expect(await page.locator(".dir-card__address").textContent()).toBe("10 Gateway Blvd, North York, M3C\u00a01H9");
  await expect(page.locator(".dir-tag--quiet")).toHaveText("Flemingdon Park");
  await expect(page.getByTestId("provider-emergency")).toHaveText("Not known");

  await page.getByTestId("back-to-directory").click();
  await expect(page).toHaveURL(/\/en\/directory$/);
  await waitForList(page);
});

test("a provider that is not in the release says so", async ({ page }) => {
  await setUp(page);
  await openResident(page, "/en/directory/P999", 390);

  await expect(page.getByTestId("provider-not-found")).toHaveText("This place could not be found.");
  expect((await page.request.get("/en/directory/not-an-id")).status()).toBe(404);
});

test("Find help in the navigation opens the directory", async ({ page }) => {
  await setUp(page);
  await openResident(page, "/en", 390);

  await page.getByTestId("shell-nav-help").click();
  await expect(page).toHaveURL(/\/en\/directory$/);
  await expect(page.getByTestId("shell-nav-help")).toHaveAttribute("aria-current", "page");
  await waitForList(page);
});

test("the filters survive opening a provider and going back, are kept in the tab's session storage and never in the address", async ({ page }) => {
  await setUp(page);
  await openResident(page, "/en/directory", 390);
  await waitForList(page);

  await openFilters(page);
  await page.getByTestId("filter-category-food").check();
  await page.getByTestId("filter-category-health").check();
  await page.getByTestId("filter-emergency").check();
  await page.getByTestId("filters-apply").click();
  expect(await listed(page)).toEqual(["P101"]);

  // Open the provider and come back by the page's own link.
  await page.getByTestId("provider-link").click();
  await expect(page).toHaveURL(/\/en\/directory\/P101$/);
  await page.getByTestId("back-to-directory").click();
  await expect(page).toHaveURL(/\/en\/directory$/);
  await waitForList(page);
  expect(await listed(page)).toEqual(["P101"]);
  await expect(page.getByTestId("filter-bar").locator("li")).toHaveText(["Food×", "Health and wellness×", "Helps in an emergency×"]);
  await expect(page.getByTestId("filters-toggle")).toHaveText("Filters (3)");

  // And by the browser's Back button.
  await page.getByTestId("provider-link").click();
  await expect(page).toHaveURL(/\/en\/directory\/P101$/);
  await page.goBack();
  await waitForList(page);
  expect(await listed(page)).toEqual(["P101"]);

  // Kept for the tab only: in sessionStorage, not in localStorage, not in the address.
  expect(page.url()).not.toContain("?");
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("cvh.directory-filters")!))).toEqual({ v: 1, categories: ["food", "health"], neighbourhoods: [], emergency: true });
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.includes("filters")))).toEqual([]);

  // Another tab of the same phone starts with no filters.
  const other = await page.context().newPage();
  await other.goto("/en/directory");
  await expect(other.getByTestId("directory-list")).toBeVisible();
  await expect(other.getByTestId("filter-bar")).toHaveCount(0);
  await other.close();

  // Clear all forgets them.
  await page.getByTestId("clear-all").click();
  expect(await page.evaluate(() => sessionStorage.getItem("cvh.directory-filters"))).toBeNull();
  await page.reload();
  await waitForList(page);
  await expect(page.getByTestId("filter-bar")).toHaveCount(0);
});

test("a kept filter whose topic the next release no longer has is dropped, and the rest stays", async ({ page }) => {
  await setUp(page);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("cvh.directory-filters")) sessionStorage.setItem("cvh.directory-filters", JSON.stringify({ v: 1, categories: ["food", "gone-topic"], neighbourhoods: ["XX"], emergency: false }));
  });
  await openResident(page, "/en/directory", 390);
  await waitForList(page);

  await expect(page.getByTestId("filter-bar").locator("li")).toHaveText(["Food×"]);
  expect(await listed(page)).toEqual(["P101"]);
});

test.describe("the filter panel and the applied filters, by keyboard and screen reader", () => {
  test("the filter groups are fieldsets with a legend, so a screen reader announces the group", async ({ page }) => {
    await setUp(page);
    await openResident(page, "/en/directory", 390);
    await waitForList(page);
    await openFilters(page);

    await expect(page.locator("[data-testid=filter-panel] fieldset > legend")).toHaveText(["Topic", "Which neighbourhood?"]);
    await expect(page.getByRole("group", { name: "Topic" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Which neighbourhood?" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Topic" }).getByRole("checkbox")).toHaveCount(4);
    await expect(page.getByRole("group", { name: "Which neighbourhood?" }).getByRole("checkbox")).toHaveCount(2);
  });

  test("focus returns to the Filters button when the panel closes, from Show results or from the button itself", async ({ page }) => {
    await setUp(page);
    await openResident(page, "/en/directory", 390);
    await waitForList(page);

    await openFilters(page);
    await page.getByTestId("filter-category-food").check();
    await page.getByTestId("filters-apply").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("filter-panel")).toBeHidden();
    await expect(page.getByTestId("filters-toggle")).toBeFocused();

    await page.getByTestId("filters-toggle").press("Enter");
    await expect(page.getByTestId("filter-panel")).toBeVisible();
    await page.getByTestId("filters-toggle").press("Enter");
    await expect(page.getByTestId("filter-panel")).toBeHidden();
    await expect(page.getByTestId("filters-toggle")).toBeFocused();
  });

  test("removing an applied filter moves focus to the next one, then to Clear all, then to the Filters button when none is left", async ({ page }) => {
    await setUp(page);
    await openResident(page, "/en/directory", 390);
    await waitForList(page);
    await openFilters(page);
    await page.getByTestId("filter-category-community").check();
    await page.getByTestId("filter-neighbourhood-TP").check();
    await page.getByTestId("filter-emergency").check();
    await page.getByTestId("filters-apply").click();
    await expect(page.getByTestId("filter-bar").locator("li")).toHaveText(["Public spaces×", "Thorncliffe Park×", "Helps in an emergency×"]);

    await page.getByTestId("remove-category:community").click();
    await expect(page.getByTestId("remove-neighbourhood:TP")).toBeFocused();

    await page.getByTestId("remove-neighbourhood:TP").click();
    await expect(page.getByTestId("remove-emergency")).toBeFocused();

    // Put one back so that the one removed is the last of two: Clear all takes the focus.
    await page.getByTestId("filters-toggle").click();
    await page.getByTestId("filter-neighbourhood-FP").check();
    await page.getByTestId("filters-apply").click();
    await expect(page.getByTestId("filter-bar").locator("li")).toHaveText(["Flemingdon Park×", "Helps in an emergency×"]);
    await page.getByTestId("remove-emergency").click();
    await expect(page.getByTestId("clear-all")).toBeFocused();

    // The last one: the bar goes, and focus goes to the Filters button, not to the top of the page.
    await page.getByTestId("remove-neighbourhood:FP").click();
    await expect(page.getByTestId("filter-bar")).toHaveCount(0);
    await expect(page.getByTestId("filters-toggle")).toBeFocused();
  });

  test("Clear all, in the bar and in the no-results screen, leaves focus on the Filters button", async ({ page }) => {
    await setUp(page);
    await openResident(page, "/en/directory", 390);
    await waitForList(page);
    await openFilters(page);
    await page.getByTestId("filter-emergency").check();
    await page.getByTestId("filters-apply").click();
    await page.getByTestId("clear-all").click();
    await expect(page.getByTestId("filters-toggle")).toBeFocused();

    await openFilters(page);
    await page.getByTestId("filter-category-health").check();
    await page.getByTestId("filter-neighbourhood-TP").check();
    await page.getByTestId("filters-apply").click();
    await page.getByTestId("empty-clear").click();
    await expect(page.getByTestId("filters-toggle")).toBeFocused();
  });
});

test("the buildings the resident chose suggest their neighbourhood as a chip to tap, and nothing is filtered until they do", async ({ page }) => {
  await setUp(page);
  await stubBuildingList(page);
  // 10 Overlea Blvd (rsn 700000010) is in Flemingdon Park in the sample building list.
  await page.addInitScript(() => localStorage.setItem("cvh.choices", JSON.stringify({ v: 1, welcomed: true, buildings: ["700000010"] })));
  await openResident(page, "/en/directory", 390);
  await waitForList(page);

  const chip = page.getByTestId("suggest-neighbourhood-FP");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("Show only Flemingdon Park");
  await expect(page.getByTestId("filter-suggestions")).toContainText("From your choices");
  // Not applied: the whole list shows, with no applied filter and no chip in the bar.
  expect(await listed(page)).toHaveLength(5);
  await expect(page.getByTestId("filter-bar")).toHaveCount(0);
  await expect(page.getByTestId("filters-toggle")).toHaveText("Filters");
  await expect(page.getByTestId("suggest-neighbourhood-TP")).toHaveCount(0);

  await chip.click();

  await expect(page.getByTestId("chip-neighbourhood:FP")).toBeVisible();
  expect((await listed(page)).sort()).toEqual(["P102", "P105"]);
  await expect(page.getByTestId("filter-suggestions")).toHaveCount(0);
  await expect(page.getByTestId("from-choices")).toHaveCount(0);

  // Removing it brings the whole list back and the suggestion with it; it did not change what the phone saved.
  await page.getByTestId("remove-neighbourhood:FP").click();
  expect(await listed(page)).toHaveLength(5);
  await expect(page.getByTestId("suggest-neighbourhood-FP")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cvh.choices")!).buildings)).toEqual(["700000010"]);
});

test("a resident with no saved buildings is offered no suggestion", async ({ page }) => {
  await setUp(page);
  await stubBuildingList(page);
  await openResident(page, "/en/directory", 390);
  await waitForList(page);

  await expect(page.getByTestId("filter-suggestions")).toHaveCount(0);
});

test("a call button is one unit: its number never breaks, and it stays inside a 320 px screen", async ({ page }) => {
  await setUp(page);
  await openResident(page, "/en/directory/P102", 320);
  const calls = page.getByTestId("provider-call");
  await expect(calls).toHaveCount(4);

  for (const call of await calls.all()) {
    const look = await call.evaluate((element) => {
      const number = element.querySelector("bdi")!;
      const box = element.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(number).lineHeight) || parseFloat(getComputedStyle(number).fontSize) * 1.5;
      return {
        wrap: getComputedStyle(element).flexWrap,
        nowrap: getComputedStyle(number).whiteSpace,
        numberLines: Math.round(number.getBoundingClientRect().height / lineHeight),
        inside: box.left >= 0 && box.right <= document.documentElement.clientWidth,
      };
    });
    expect(look, await call.innerText()).toEqual({ wrap: "wrap", nowrap: "nowrap", numberLines: 1, inside: true });
  }
  await openResident(page, "/en/directory", 320);
  await page.getByTestId("filters-toggle").click();
  await page.getByTestId("filter-category-health").check();
  await page.getByTestId("filter-neighbourhood-TP").check();
  const hub = page.getByTestId("hub-call");
  await expect(hub).toBeVisible();
  expect(await hub.evaluate((element) => ({ nowrap: getComputedStyle(element.querySelector("bdi")!).whiteSpace, inside: element.getBoundingClientRect().right <= document.documentElement.clientWidth }))).toEqual({ nowrap: "nowrap", inside: true });
});

test.describe("in Urdu", () => {
  test("machine-translated text carries the label, and Read it in English shows the English original in place", async ({ page }) => {
    await setUp(page);
    await openResident(page, "/ur/directory", 390);
    await waitForList(page);

    const food = page.getByTestId("provider-P101");
    await expect(food.getByTestId("machine-label")).toContainText("مشین سے ترجمہ");
    await expect(food.getByTestId("provider-services")).toContainText("ہر منگل اور جمعہ کو مفت راشن");
    await expect(food.getByTestId("provider-services").locator("p")).not.toHaveAttribute("lang");
    const toggle = food.getByTestId("show-english");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await toggle.click();

    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(food.getByTestId("provider-services")).toContainText("Free groceries every Tuesday and Friday, and hot meals on Saturday.");
    await expect(food.getByTestId("provider-services").locator("p")).toHaveAttribute("lang", "en");
    await expect(food.getByTestId("provider-services").locator("p")).toHaveAttribute("dir", "ltr");
    await expect(food.getByTestId("emergency-role")).toHaveText("Hands out ready-to-eat food and water during a long power cut.");
    await expect(food.getByTestId("original-shown")).toBeVisible();
    // Only this listing changed.
    await expect(page.getByTestId("provider-P102").getByTestId("provider-services")).toContainText("فیملی ڈاکٹر");

    await toggle.click();
    await expect(food.getByTestId("provider-services")).toContainText("ہر منگل اور جمعہ کو مفت راشن");
  });

  test("English standing in for a missing translation shows one note for the page, and the text is marked as English", async ({ page }) => {
    await setUp(page);
    await openResident(page, "/ur/directory", 390);
    await waitForList(page);

    await expect(page.getByTestId("directory-unavailable-note")).toHaveCount(1);
    await expect(page.getByTestId("directory-unavailable-note")).toContainText("ابھی اس زبان میں دستیاب نہیں");
    const services = page.getByTestId("provider-P105").getByTestId("provider-services").locator("p");
    await expect(services).toHaveText("Help for newcomers: forms, job search and language classes.");
    await expect(services).toHaveAttribute("lang", "en");
    await expect(services).toHaveAttribute("dir", "ltr");
    await expect(services).toHaveAttribute("data-translation", "unavailable");
    // The content never carries the interface's [EN] marker: the note says it once.
    await expect(services).not.toContainText("[EN]");
  });

  test("addresses, phone numbers, emails and web addresses are isolated left to right in a right-to-left page", async ({ page }) => {
    await setUp(page);
    await openResident(page, "/ur/directory", 390);
    await waitForList(page);

    expect(await page.locator("html").getAttribute("dir")).toBe("rtl");
    const card = page.getByTestId("provider-P101");
    for (const text of ["(416) 555-0101", "food@example.org", "example.org/food-bank", "45 Overlea Blvd, Toronto, M4H 1K2", "Thorncliffe Park Food Bank"]) {
      const run = card.locator("bdi", { hasText: text }).first();
      await expect(run, text).toHaveAttribute("dir", "ltr");
      await expect(run, text).toHaveAttribute("lang", "en");
    }
    await expect(card.getByTestId("last-confirmed")).toHaveText("[EN] Last confirmed by the Hub September 30, 2026");
  });

  test("the machine-translation label is a solid upright tag, told apart from the dashed italic Not known; Read it in English names its listing; the original is a status", async ({ page }) => {
    await setUp(page);
    await openResident(page, "/ur/directory", 390);
    await waitForList(page);

    const food = page.getByTestId("provider-P101");
    const label = await food.locator(".dir-mt__label").evaluate((element) => ({ border: getComputedStyle(element).borderTopStyle, font: getComputedStyle(element).fontStyle, ring: element.querySelector(".dir-unknown__mark") }));
    const unknown = await page.getByTestId("provider-P103").getByTestId("provider-contact").locator(".dir-unknown").evaluate((element) => ({ font: getComputedStyle(element).fontStyle, ring: getComputedStyle(element.querySelector(".dir-unknown__mark")!).borderTopStyle }));
    expect(label).toEqual({ border: "solid", font: "normal", ring: null });
    expect(unknown).toEqual({ font: "italic", ring: "dashed" });

    const toggle = food.getByTestId("show-english");
    await expect(toggle).toHaveAttribute("aria-describedby", "provider-name-P101");
    await expect(food.locator("#provider-name-P101")).toHaveText("Thorncliffe Park Food Bank");
    await expect(toggle).toHaveAccessibleDescription("Thorncliffe Park Food Bank");
    const shown = food.getByTestId("original-shown");
    await expect(shown).toHaveAttribute("role", "status");
    await expect(shown).toHaveText("");
    await toggle.click();
    await expect(shown).toHaveAttribute("role", "status");
    await expect(shown).toHaveText(/English/);
  });

  test("a provider's name and address are aligned to the start edge and isolated in a right-to-left page, the same for both", async ({ page }) => {
    await setUp(page);
    await openResident(page, "/ur/directory", 390);
    await waitForList(page);

    const food = page.getByTestId("provider-P101");
    for (const selector of [".dir-card__name", ".dir-card__address"]) {
      const look = await food.locator(selector).evaluate((element) => ({ align: getComputedStyle(element).textAlign, bidi: getComputedStyle(element).unicodeBidi, dir: getComputedStyle(element).direction }));
      expect(look, selector).toEqual({ align: "start", bidi: "isolate", dir: "rtl" });
    }
    // Both begin at the same edge of the card.
    const edges = await food.evaluate((card) => {
      const right = (selector: string) => card.querySelector(selector)!.getBoundingClientRect().right;
      return { name: Math.round(right(".dir-card__name")), address: Math.round(right(".dir-card__address")) };
    });
    expect(edges.name).toBe(edges.address);
  });

  test("filters work on the Urdu listing and the category names are the Urdu ones", async ({ page }) => {
    await setUp(page);
    await openResident(page, "/ur/directory", 390);
    await waitForList(page);

    await openFilters(page);
    await expect(page.getByTestId("filter-category-food")).toContainText("خوراک");
    await page.getByTestId("filter-category-food").check();
    expect(await listed(page)).toEqual(["P101"]);
    await expect(page.getByTestId("chip-category:food")).toContainText("خوراک");
  });
});

test.describe("the release on the phone", () => {
  test("a newer release is downloaded in full before it replaces the list the phone has", async ({ page }) => {
    const server = await setUp(page, 7);
    await openResident(page, "/en/directory", 390);
    await waitForList(page);
    expect(await listed(page)).toHaveLength(5);

    // The Hub publishes release 8 without P105; the phone asks which release is current when the directory opens.
    server.release = 8;
    server.drop = ["P105"];
    await page.route("**/api/directory/8/en.json", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fallback();
    });
    await page.goto("/en/directory");

    // While release 8 downloads, the list of release 7 stays.
    await expect(page.getByTestId("directory-list")).toBeVisible();
    expect(await listed(page)).toHaveLength(5);
    await expect.poll(async () => (await listed(page)).length).toBe(4);
    expect(await listed(page)).not.toContain("P105");
    await expect(page.getByTestId("directory-last-updated")).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cvh.directory.en")!).listing.release_v)).toBe(8);
  });

  for (const failure of ["fail", "truncated", "invalid"] as const) {
    test(`when the newer release's file ${failure === "fail" ? "fails to download" : failure === "truncated" ? "is incomplete" : "fails its schema"}, the previous complete release shows with Last updated and no error, and the next visit tries again`, async ({
      page,
    }) => {
      const server = await setUp(page, 7);
      await openResident(page, "/en/directory", 390);
      await waitForList(page);

      server.release = 8;
      server.drop = ["P105"];
      server.file = failure;
      await page.goto("/en/directory");

      await expect(page.getByTestId("directory-last-updated")).toHaveText("Last updated October 1, 2026 at 11:00 AM");
      expect(await listed(page)).toHaveLength(5);
      await expect(page.getByTestId("directory-unavailable")).toHaveCount(0);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cvh.directory.en")!).listing.release_v)).toBe(7);

      // The next visit with signal tries release 8 again.
      server.file = "ok";
      server.requests.length = 0;
      await page.goto("/en/directory");
      await expect.poll(async () => (await listed(page)).length).toBe(4);
      expect(server.requests).toContain("GET /api/directory/8/en.json");
      await expect(page.getByTestId("directory-last-updated")).toHaveCount(0);
    });
  }

  test("a kept release shows Last updated until the manifest confirms it is the current one, and then does not", async ({ page }) => {
    const server = await setUp(page, 7);
    await openResident(page, "/en/directory", 390);
    await waitForList(page);

    // The manifest takes a while: the kept list shows at once, but nothing has said it is current.
    await page.route("**/api/directory/manifest", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.fallback();
    });
    await page.goto("/en/directory");
    await expect(page.getByTestId("directory-list")).toBeVisible();
    await expect(page.getByTestId("directory-last-updated")).toBeVisible();

    await expect(page.getByTestId("directory-last-updated")).toHaveCount(0);
    expect(server.requests.filter((r) => r.includes(".json"))).toEqual(["GET /api/directory/7/en.json"]);
  });

  test("when the manifest names an older release than the one the phone kept, the manifest's release is downloaded and shown as current", async ({ page }) => {
    const server = await setUp(page, 7);
    await openResident(page, "/en/directory", 390);
    await waitForList(page);

    server.release = 6;
    server.drop = ["P105"];
    await page.goto("/en/directory");

    await expect.poll(async () => (await listed(page)).length).toBe(4);
    await expect(page.getByTestId("directory-last-updated")).toHaveCount(0);
    expect(server.requests).toContain("GET /api/directory/6/en.json");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cvh.directory.en")!).listing.release_v)).toBe(6);
  });

  test("when the manifest names the same release number made from another catalogue, the file is downloaded again", async ({ page }) => {
    const server = await setUp(page, 7);
    await openResident(page, "/en/directory", 390);
    await waitForList(page);
    server.requests.length = 0;

    server.hash = "d".repeat(64);
    server.drop = ["P105"];
    await page.goto("/en/directory");

    await expect.poll(async () => (await listed(page)).length).toBe(4);
    expect(server.requests).toEqual(["GET /api/directory/manifest", "GET /api/directory/7/en.json"]);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cvh.directory.en")!).listing.catalogue_hash)).toBe("d".repeat(64));
    await expect(page.getByTestId("directory-last-updated")).toHaveCount(0);
  });

  test("with no signal at all the list the phone has still opens, with Last updated", async ({ page }) => {
    const server = await setUp(page, 7);
    await openResident(page, "/en/directory", 390);
    await waitForList(page);

    server.manifestDown = true;
    await page.goto("/en/directory");

    await expect(page.getByTestId("directory-last-updated")).toBeVisible();
    expect(await listed(page)).toHaveLength(5);
  });

  test("when no release has ever been kept and none can be downloaded, the resident sees that the directory could not load, with the Hub's number and the numbers page", async ({ page }) => {
    const server = await setUp(page, 7);
    server.file = "fail";
    await openResident(page, "/en/directory", 390);

    const box = page.getByTestId("directory-unavailable");
    await expect(box).toBeVisible();
    await expect(box.locator("h2")).toHaveText("The directory could not load");
    await expect(page.getByTestId("hub-call")).toHaveText("Call (416) 421-8997");
    await expect(page.getByTestId("hub-call")).toHaveAttribute("href", "tel:+14164218997");
    await expect(page.getByTestId("directory-list")).toHaveCount(0);
    // The numbers page is S02.10's and is not there yet: no link to it, and no sentence about it (numbers-route.ts).
    await expect(page.getByTestId("numbers-link")).toHaveCount(0);
    await expect(page.getByText("numbers page")).toHaveCount(0);
    // The lead that asks for a topic has nothing to narrow on this screen.
    await expect(page.getByText("Choose a topic or a neighbourhood")).toHaveCount(0);

    // And it recovers on the next visit with signal.
    server.file = "ok";
    await page.goto("/en/directory");
    await waitForList(page);
  });

  test("a listing for the page language is kept per language, and the older release of another language is dropped when a newer one is kept", async ({ page }) => {
    const server = await setUp(page, 7);
    await openResident(page, "/en/directory", 390);
    await waitForList(page);
    server.release = 8;
    await page.goto("/ur/directory");
    await waitForList(page);

    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("cvh.directory.")))).toEqual(["cvh.directory.ur"]);
    expect(await page.evaluate(() => localStorage.getItem("cvh.choices"))).toContain("welcomed");
  });
});

test("every control is at least the tap size, and the page does not scroll sideways, at 320 and 390", async ({ page }) => {
  await setUp(page);
  for (const width of [320, 390]) {
    await openResident(page, "/ur/directory", width);
    await waitForList(page);
    await openFilters(page);
    await page.getByTestId("filter-category-food").check();
    const small = await page.evaluate(() => {
      const minimum = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tap-current"));
      return [...document.querySelectorAll<HTMLElement>("main a[href], main button, main label.dir-option")]
        .filter((element) => element.checkVisibility())
        .filter((element) => {
          const { width: w, height: h } = element.getBoundingClientRect();
          return w < minimum || h < minimum;
        })
        .map((element) => element.outerHTML.slice(0, 80));
    });
    expect(small, `${width}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});

test.describe("baselines", () => {
  for (const lang of ["en", "ur"] as const) {
    for (const width of [390, 1280]) {
      const name = (state: string) => `directory-${state}-${lang}-${width}.png`;

      test(`${lang} at ${width}`, async ({ page }) => {
        await setUp(page);
        await openResident(page, `/${lang}/directory`, width);
        await waitForList(page);
        await shot(page, width, name("list"));

        await openFilters(page);
        await page.getByTestId("filter-neighbourhood-TP").check();
        await page.getByTestId("filter-emergency").check();
        await shot(page, width, name("filtered"));

        await page.getByTestId("filter-category-health").check();
        await shot(page, width, name("empty"));

        await openResident(page, `/${lang}/directory/P104`, width);
        await expect(page.getByTestId("provider-P104")).toBeVisible();
        await shot(page, width, name("provider"));
      });

      test(`${lang} at ${width}, the directory could not load`, async ({ page }) => {
        const server = await setUp(page);
        server.file = "fail";
        await openResident(page, `/${lang}/directory`, width);
        await expect(page.getByTestId("directory-unavailable")).toBeVisible();
        await shot(page, width, name("unavailable"));
      });

      test(`${lang} at ${width}, an earlier release with Last updated`, async ({ page }) => {
        const server = await setUp(page);
        await openResident(page, `/${lang}/directory`, width);
        await waitForList(page);
        server.release = 8;
        server.file = "fail";
        await page.goto(`/${lang}/directory`);
        await expect(page.getByTestId("directory-last-updated")).toBeVisible();
        await waitForList(page);
        await shot(page, width, name("previous"));
      });
    }
  }
});
