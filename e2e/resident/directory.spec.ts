import { expect, test, type Page } from "@playwright/test";
import { stubBuildingList } from "./choices-fixture";
import { newServer, stubDirectory, type DirectoryServer } from "./directory-fixture";
import { expectBaseline, openResident, waitForFonts } from "./helpers";

// S02.06: a resident browses and filters the directory (/{lang}/directory, /{lang}/directory/{id}). The release routes
// are answered by directory-fixture.ts (the resident server has no database in these tests): release 7 has five sample
// providers; P101 and P104 have an emergency role, P101 and P104 are in Thorncliffe Park, P102 and P105 in Flemingdon Park.
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

test("reads only the published release files, and filtering and browsing make no request at all", async ({ page }) => {
  const server = await setUp(page);
  const others: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/directory/")) others.push(`${request.method()} ${url.pathname}`);
  });
  await openResident(page, "/en/directory", 390);
  await waitForList(page);
  await page.waitForLoadState("networkidle");
  expect(server.requests).toEqual(["GET /api/directory/manifest", "GET /api/directory/7/en.json"]);

  await openFilters(page);
  await page.getByTestId("filter-category-food").check();
  await page.getByTestId("filter-emergency").check();
  await page.getByTestId("filter-neighbourhood-FP").check();
  await page.getByTestId("clear-all").click();
  await page.getByTestId("provider-link").first().click();
  await page.getByTestId("back-to-directory").click();
  await page.waitForLoadState("networkidle");

  // Opening the provider's page and coming back asked the server which release is current, and nothing more: the file is kept.
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
    await expect(page.getByTestId("numbers-link")).toHaveAttribute("href", "/en/ready/numbers");
    await expect(page.getByTestId("directory-list")).toHaveCount(0);

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

test("the buildings the resident chose suggest a neighbourhood, marked as from their choices and removable", async ({ page }) => {
  await setUp(page);
  await stubBuildingList(page);
  // 10 Overlea Blvd (rsn 700000010) is in Flemingdon Park in the sample building list.
  await page.addInitScript(() => localStorage.setItem("cvh.choices", JSON.stringify({ v: 1, welcomed: true, buildings: ["700000010"] })));
  await openResident(page, "/en/directory", 390);
  await waitForList(page);

  await expect(page.getByTestId("chip-neighbourhood:FP")).toBeVisible();
  await expect(page.getByTestId("from-choices")).toHaveText("Some filters come from your choices");
  expect((await listed(page)).sort()).toEqual(["P102", "P105"]);

  await page.getByTestId("remove-neighbourhood:FP").click();
  await expect(page.getByTestId("filter-bar")).toHaveCount(0);
  expect(await listed(page)).toHaveLength(5);
  // Removing it did not change what the phone saved.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cvh.choices")!).buildings)).toEqual(["700000010"]);
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
