import { expect, test, type Page } from "@playwright/test";
import { expectBaseline, openResident } from "./helpers";

// S02.10: Be ready (R-24), a guide (R-25) and the essential numbers (R-31) in the resident shell. The server runs with
// CVH_FAKE_GUIDES_FILE and CVH_FAKE_BUILDINGS_FILE (playwright.resident.config.ts), so the sample guides and buildings in
// e2e/resident/fixtures stand in for the database. The Urdu sample translates the power guide in part (its title, the
// 911 text and a few lines) and the 911 number's label and text; every other text is English with
// translation.unavailable. Every fixture date is on or before 2026-10-01.
//   buildings 4154146 (a Hub contact entered on 2026-09-30) and 4154159 (no contact) are the ones the tests choose.

const READY = "/en/ready";
const POWER = "/en/ready/power";
const NUMBERS = "/en/ready/numbers";
const CHOICES = JSON.stringify({ v: 1, lang: "en", buildings: ["4154146", "4154159"] });

/** The resident has chosen buildings on their phone (AD-3): saved before the page loads. */
async function chooseBuildings(page: Page, choices = CHOICES) {
  await page.addInitScript((value) => window.localStorage.setItem("cvh.choices", value), choices);
}

/** Grows the viewport to the whole page, so the baseline shows everything, not the first screen. */
async function showWholePage(page: Page, width: number) {
  const needed = await page.evaluate(() => {
    const main = document.querySelector("main")!;
    const around = document.documentElement.clientHeight - main.clientHeight;
    return Math.ceil(main.scrollHeight + around);
  });
  await page.setViewportSize({ width, height: needed });
}

const overflow = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector("main")!;
    return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, main: main.scrollWidth - main.clientWidth };
  });

test.describe("Be ready (R-24)", () => {
  test("lists the six guides with their reading time, and a way to the numbers", async ({ page }) => {
    const response = await openResident(page, READY, 390);

    expect(response!.status()).toBe(200);
    await expect(page.locator("main h1")).toHaveText("Be ready");
    const rows = await page.locator('[data-testid^="ready-guide-"]').evaluateAll((links) =>
      links.map((link) => [link.querySelector(".ready-dest__title")!.textContent, link.querySelector(".ready-dest__line")!.textContent, link.getAttribute("href")]),
    );
    expect(rows).toEqual([
      ["Power outage", "3 minute read", "/en/ready/power"],
      ["Flood or plumbing failure", "3 minute read", "/en/ready/flood"],
      ["Elevator failure", "2 minute read", "/en/ready/elevator"],
      ["Extreme heat", "3 minute read", "/en/ready/heat"],
      ["Wildfire smoke", "3 minute read", "/en/ready/smoke"],
      ["Fire and evacuation", "2 minute read", "/en/ready/fire"],
    ]);
    await expect(page.getByTestId("ready-numbers")).toHaveAttribute("href", "/en/ready/numbers");
  });

  test("opens a guide from the list, and the Be ready item of the navigation stays current", async ({ page }) => {
    await openResident(page, READY, 390);
    await page.getByTestId("ready-guide-heat").click();
    await page.waitForURL("**/en/ready/heat");

    await expect(page.locator("main h1")).toHaveText("Extreme heat");
    await expect(page.getByTestId("shell-nav-ready")).toHaveAttribute("aria-current", "page");
  });

  test("shows the Urdu page's titles in English, left to right, with the page's own words in Urdu", async ({ page }) => {
    await openResident(page, "/ur/ready", 390);

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    // The power guide's title is translated in the sample; the others are English with translation.unavailable.
    const power = page.getByTestId("ready-guide-power").locator(".ready-dest__title");
    await expect(power).toHaveText("بجلی کی بندش");
    await expect(power).not.toHaveAttribute("lang", "en");
    const flood = page.getByTestId("ready-guide-flood").locator(".ready-dest__title");
    await expect(flood).toHaveText("Flood or plumbing failure");
    await expect(flood).toHaveAttribute("lang", "en");
    await expect(flood).toHaveAttribute("dir", "ltr");
    await expect(flood).toHaveAttribute("data-translation", "unavailable");
    // Some titles are English, so the page says so once, in the catalog's x04 words.
    await expect(page.getByTestId("ready-unavailable")).toHaveCount(1);
    await expect(page.getByTestId("ready-unavailable")).toContainText("ابھی اس زبان میں دستیاب نہیں");
    await expect(page.getByTestId("ready-unavailable")).toContainText("اس کا ابھی اردو میں ترجمہ نہیں ہوا۔");
  });

  test("says nothing about translation in English", async ({ page }) => {
    await openResident(page, READY, 390);

    await expect(page.getByTestId("ready-unavailable")).toHaveCount(0);
  });
});

test.describe("the back arrow", () => {
  const transformOf = (page: Page) => page.locator(".ready-back .shell-ico--mirror").first().evaluate((icon) => getComputedStyle(icon).transform);

  test("is turned around in a right-to-left language (the numbers page and a guide)", async ({ page }) => {
    for (const path of ["/ur/ready/numbers", "/ur/ready/power"]) {
      await openResident(page, path, 390);

      await expect(page.locator("html"), path).toHaveAttribute("dir", "rtl");
      expect(await transformOf(page), path).toBe("matrix(-1, 0, 0, 1, 0, 0)");
    }
  });

  test("is not turned around in English", async ({ page }) => {
    for (const path of [NUMBERS, POWER]) {
      await openResident(page, path, 390);

      expect(await transformOf(page), path).toBe("none");
    }
  });
});

test.describe("a guide (R-25)", () => {
  test("shows the 911 block at the top, then before, during and after, then who reviewed it and when", async ({ page }) => {
    const response = await openResident(page, POWER, 390);

    expect(response!.status()).toBe(200);
    await expect(page.locator("main h1")).toHaveText("Power outage");
    // The block comes before the first part of the guide, and after the title.
    const order = await page.evaluate(() => {
      // What compareDocumentPosition says is about the 911 block, seen from the element named.
      const position = (selector: string) => document.querySelector(selector)!.compareDocumentPosition(document.querySelector('[data-component="not-911"]')!);
      return {
        afterTitle: Boolean(position("main h1") & Node.DOCUMENT_POSITION_FOLLOWING),
        beforeSteps: Boolean(position('[data-testid="guide-before"]') & Node.DOCUMENT_POSITION_PRECEDING),
      };
    });
    expect(order).toEqual({ afterTitle: true, beforeSteps: true });
    await expect(page.locator('[data-component="not-911"]')).toHaveCount(1);
    await expect(page.locator('[data-component="not-911"]')).toContainText("The CVH is not an emergency service.");
    await expect(page.locator('[data-component="not-911"]')).toContainText("If someone is in danger, call 911.");
    await expect(page.getByTestId("guide-when911")).toContainText("Call 911 if someone is in danger, there is a fire");

    const headings = await page.locator(".guide-section h2").allTextContents();
    expect(headings).toEqual(["Before", "During", "After"]);
    for (const [section, count] of [["before", 4], ["during", 4], ["after", 3]] as const) {
      await expect(page.getByTestId(`guide-${section}`).locator("li")).toHaveCount(count);
    }
    await expect(page.getByTestId("guide-reviewed")).toHaveText("Reviewed by the Hub, last updated September 30, 2026");
    // It is the last thing in the guide.
    expect(await page.locator("main .layout-screen__body > div > *:last-child").getAttribute("data-testid")).toBe("guide-reviewed");
    await expect(page.getByTestId("guide-numbers")).toHaveAttribute("href", "/en/ready/numbers");
  });

  test("opened from a link with #during, it scrolls to During and puts the focus on that heading", async ({ page }) => {
    await openResident(page, `${POWER}#during`, 390);

    const heading = page.getByTestId("guide-heading-during");
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    await expect(heading).toHaveText("During");
    await expect(page.getByTestId("guide-opened-during")).toHaveText('Opened at "During" because this is happening now.');
    // The first part of the guide is above the viewport now.
    await expect(page.getByTestId("guide-heading-before")).not.toBeInViewport();
  });

  test("opened from a link with #before or #after, it does the same for that part", async ({ page }) => {
    await openResident(page, `${POWER}#after`, 390);
    await expect(page.getByTestId("guide-heading-after")).toBeFocused();
    await expect(page.getByTestId("guide-heading-after")).toBeInViewport();
    await expect(page.getByTestId("guide-opened-during")).toHaveCount(0);

    await openResident(page, `${POWER}#before`, 390);
    await expect(page.getByTestId("guide-heading-before")).toBeFocused();
  });

  test("opened from the list, it starts at the top with the focus nowhere in the guide, and an unknown #part is ignored", async ({ page }) => {
    await openResident(page, POWER, 390);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
    await expect(page.getByTestId("guide-opened-during")).toHaveCount(0);

    await openResident(page, `${POWER}#nonsense`, 390);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
    await expect(page.getByTestId("guide-opened-during")).toHaveCount(0);
  });

  test("the Jump to links move to a part of the guide and put the focus on its heading", async ({ page }) => {
    await openResident(page, POWER, 390);

    await page.getByTestId("guide-jump-during").click();
    await expect(page.getByTestId("guide-heading-during")).toBeFocused();
    await expect(page.getByTestId("guide-heading-during")).toBeInViewport();
    await page.getByTestId("guide-jump-after").click();
    await expect(page.getByTestId("guide-heading-after")).toBeFocused();
    // Following a Jump to link is not "opened because this is happening now".
    await expect(page.getByTestId("guide-opened-during")).toHaveCount(0);
  });

  test("is a 404 inside the shell for a guide that does not exist", async ({ page }) => {
    for (const path of ["/en/ready/no-such-guide", "/ur/ready/NOT A GUIDE", "/en/ready/power/extra"]) {
      const response = await openResident(page, path, 390);

      expect(response!.status(), path).toBe(404);
      // A shared cache must not keep the 404 of an address anyone can make up.
      const cacheControl = response!.headers()["cache-control"] ?? "";
      expect(cacheControl, path).not.toContain("s-maxage");
      expect(cacheControl, path).not.toContain("public");
      await expect(page.getByTestId("shell-nav"), path).toBeVisible();
      await expect(page.locator("main h1"), path).toContainText("This page could not be found.");
    }
  });

  test("shows text with no reviewed translation in English, left to right, says so once, and keeps the translated parts", async ({ page }) => {
    await openResident(page, "/ur/ready/power", 390);

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    // Translated: the title, the 911 text and a few lines.
    await expect(page.getByTestId("guide-title")).toHaveText("بجلی کی بندش");
    await expect(page.getByTestId("guide-title")).not.toHaveAttribute("lang", "en");
    await expect(page.getByTestId("guide-when911").locator("p")).toContainText("911 پر کال کریں");
    await expect(page.getByTestId("guide-when911").locator("p")).not.toHaveAttribute("lang", "en");
    // Not translated: English with translation.unavailable, set left to right on the line itself.
    const english = page.getByTestId("guide-before").locator("li").nth(2);
    await expect(english).toHaveText("Write down important phone numbers on paper.");
    await expect(english).toHaveAttribute("lang", "en");
    await expect(english).toHaveAttribute("dir", "ltr");
    await expect(english).toHaveAttribute("data-translation", "unavailable");
    const translated = page.getByTestId("guide-before").locator("li").first();
    await expect(translated).not.toHaveAttribute("lang", "en");
    // The page says so once.
    await expect(page.getByTestId("guide-unavailable")).toHaveCount(1);
    await expect(page.getByTestId("guide-unavailable")).toContainText("ابھی اس زبان میں دستیاب نہیں");
    await expect(page.getByTestId("guide-unavailable")).toContainText("اس کا ابھی اردو میں ترجمہ نہیں ہوا۔");
    await expect(page.getByTestId("guide-unavailable")).not.toContainText("[EN]");
    // A guide with no translated text at all says it is not available in the language.
    await openResident(page, "/ur/ready/flood", 390);
    await expect(page.getByTestId("guide-unavailable")).toContainText("اردو");
    await expect(page.getByTestId("guide-title")).toHaveAttribute("lang", "en");
    // English needs no note.
    await openResident(page, POWER, 390);
    await expect(page.getByTestId("guide-unavailable")).toHaveCount(0);
    await expect(page.locator('[data-translation="unavailable"]')).toHaveCount(0);
  });

  test("opened with #during in a right-to-left language, it still lands on During", async ({ page }) => {
    await openResident(page, "/ur/ready/power#during", 390);

    await expect(page.getByTestId("guide-heading-during")).toBeFocused();
    await expect(page.getByTestId("guide-heading-during")).toBeInViewport();
  });
});

test.describe("the essential numbers (R-31)", () => {
  test("shows 911 apart with when to call it, then 211, 311, Toronto Hydro and the Hub, each a tel: link with a text label", async ({ page }) => {
    const response = await openResident(page, NUMBERS, 390);

    expect(response!.status()).toBe(200);
    await expect(page.locator("main h1")).toHaveText("Numbers I might need");
    const emergency = page.getByTestId("numbers-911");
    await expect(page.getByTestId("numbers-911-digits")).toHaveText("911");
    await expect(page.getByTestId("numbers-911-when")).toHaveText("Call 911 if someone's life or safety is in danger right now: fire, a medical emergency, or a crime happening now.");
    await expect(page.getByTestId("numbers-911-call")).toHaveAttribute("href", "tel:911");
    await expect(page.getByTestId("numbers-911-call")).toHaveText("Call 911");
    // 911 is not among the others.
    await expect(page.getByTestId("numbers-others").locator('[data-testid="number-911"]')).toHaveCount(0);
    await expect(emergency).toBeVisible();

    const rows = await page.getByTestId("numbers-others").locator("li.num").evaluateAll((items) =>
      items.map((item) => [
        item.querySelector(".num__purpose")!.textContent,
        item.querySelector(".num__digits")!.textContent,
        item.querySelector("a")!.getAttribute("href"),
        item.querySelector("a")!.textContent?.trim(),
      ]),
    );
    expect(rows).toEqual([
      ["Help finding community, social and government services", "211", "tel:211", "Call"],
      ["City of Toronto services and non-emergency problems", "311", "tel:311", "Call"],
      ["Report a power outage to Toronto Hydro", "(416) 542-8000", "tel:+14165428000", "Call"],
      ["Talk to someone at the Hub", "(416) 421-8997", "tel:+14164218997", "Call"],
    ]);
    // Every call link says what it calls, for a screen reader.
    await expect(page.getByTestId("number-211-call")).toHaveAttribute("aria-label", "Call Help finding community, social and government services, 211");
    // A ten-digit number is written as the buildings' contacts are, in the text and for a screen reader; the link still dials the full number.
    await expect(page.getByTestId("number-hydro-call")).toHaveAttribute("aria-label", "Call Report a power outage to Toronto Hydro, (416) 542-8000");
    await expect(page.getByTestId("numbers-checked")).toHaveText("Checked by the Hub, last updated September 30, 2026");
    // The numbers come before the resident's buildings, and the 911 block closes the page.
    await expect(page.locator('[data-component="not-911"]')).toHaveCount(1);
    await expect(page.locator('[data-component="not-911"]')).toHaveAttribute("data-variant", "inline");
  });

  test("shows the contacts of the buildings the resident chose: the Hub's contact where there is one, and no contact where there is none", async ({ page }) => {
    await chooseBuildings(page);
    await openResident(page, NUMBERS, 390);

    const section = page.getByTestId("numbers-buildings");
    await expect(section).toBeVisible();
    await expect(section.locator("h2")).toHaveText("Your building");
    const cards = section.getByTestId("building-contact-card");
    await expect(cards).toHaveCount(2);

    const known = cards.nth(0);
    await expect(known).toHaveAttribute("data-rsn", "4154146");
    await expect(known.getByTestId("building-contact-role")).toHaveText("Superintendent");
    await expect(known.getByTestId("building-contact-address")).toHaveText("4 Milepost Pl");
    await expect(known.getByTestId("building-contact-phone")).toHaveText("(416) 555-0123");
    await expect(known.getByTestId("building-contact-call")).toHaveAttribute("href", "tel:+14165550123");
    await expect(known.getByTestId("building-contact-call")).toHaveText("Call");
    await expect(known.getByTestId("building-contact-call")).toHaveAttribute("aria-label", "Call Superintendent, (416) 555-0123");
    await expect(known.getByTestId("building-contact-provided")).toHaveText("Provided by the Hub, last updated September 30, 2026");

    // No contact: the prototype's words for it with no floor ambassador (R31.noBuildingNoAmb: there is no ambassador
    // coverage yet), not the building page's "Not known"; and no call link.
    const none = cards.nth(1);
    await expect(none).toHaveAttribute("data-rsn", "4154159");
    await expect(none.getByTestId("building-contact-none")).toHaveText("We don't have a contact for your building yet. The Hub can help you reach your building management.");
    await expect(none).not.toContainText("ambassador");
    await expect(none.getByTestId("building-contact-address")).toHaveText("85-95 Thorncliffe Park Dr");
    await expect(none.locator("a")).toHaveCount(0);
    await expect(section).not.toContainText("Not known");
  });

  test("keeps the order the resident chose their buildings in, and skips a building that is not in the list", async ({ page }) => {
    await chooseBuildings(page, JSON.stringify({ v: 1, buildings: ["4154159", "999999999", "4154146"] }));
    await openResident(page, NUMBERS, 390);

    await expect(page.getByTestId("building-contact-card")).toHaveCount(2);
    expect(await page.getByTestId("building-contact-card").evaluateAll((cards) => cards.map((card) => card.getAttribute("data-rsn")))).toEqual(["4154159", "4154146"]);
  });

  test("with no building chosen, invites the resident to choose one; the numbers above still work", async ({ page }) => {
    await openResident(page, NUMBERS, 390);

    const none = page.getByTestId("numbers-no-building");
    await expect(none).toBeVisible();
    await expect(none).toContainText("Choose your building and we will show its contact here when we have one. Until then, the Hub can help.");
    await expect(page.getByTestId("numbers-choose")).toHaveAttribute("href", "/en/choices/place");
    await expect(page.getByTestId("building-contact-card")).toHaveCount(0);
    await expect(page.getByTestId("number-hub-call")).toHaveAttribute("href", "tel:+14164218997");
  });

  test("a phone with unusable choices is the same as no choices", async ({ page }) => {
    await chooseBuildings(page, "{not json");
    await openResident(page, NUMBERS, 390);

    await expect(page.getByTestId("numbers-no-building")).toBeVisible();
  });

  test("never tells the server which buildings were chosen: no request carries a register number", async ({ page }) => {
    await chooseBuildings(page);
    const requests: string[] = [];
    page.on("request", (request) => requests.push(`${request.method()} ${request.url()} ${request.postData() ?? ""}`));
    await openResident(page, NUMBERS, 390);
    await expect(page.getByTestId("building-contact-card")).toHaveCount(2);
    await page.waitForLoadState("networkidle");

    expect(requests.length).toBeGreaterThan(1);
    for (const request of requests) {
      expect(request).not.toContain("4154146");
      expect(request).not.toContain("4154159");
    }
  });

  test("shows the numbers' words in Urdu where there are any, the rest in English left to right, and every number as a left-to-right run", async ({ page }) => {
    await chooseBuildings(page);
    await openResident(page, "/ur/ready/numbers", 390);

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("numbers-911-when")).toContainText("911 پر کال کریں");
    await expect(page.getByTestId("numbers-911-when")).not.toHaveAttribute("lang", "en");
    const purpose = page.getByTestId("number-211-purpose");
    await expect(purpose).toHaveAttribute("lang", "en");
    await expect(purpose).toHaveAttribute("dir", "ltr");
    await expect(purpose).toHaveAttribute("data-translation", "unavailable");
    // The note is the catalog's own x04 wording, in Urdu, with the language named in its own script.
    await expect(page.getByTestId("numbers-unavailable")).toHaveCount(1);
    await expect(page.getByTestId("numbers-unavailable")).toContainText("ابھی اس زبان میں دستیاب نہیں");
    await expect(page.getByTestId("numbers-unavailable")).toContainText("اس کا ابھی اردو میں ترجمہ نہیں ہوا۔");
    await expect(page.getByTestId("numbers-unavailable")).not.toContainText("[EN]");
    // A number is a left-to-right run whatever the page's direction.
    await expect(page.getByTestId("number-hydro-digits")).toHaveText("(416) 542-8000");
    await expect(page.getByTestId("number-hydro-digits")).toHaveAttribute("dir", "ltr");
    await expect(page.getByTestId("numbers-911-digits").locator("bdi")).toHaveAttribute("dir", "ltr");
    // The English strings Urdu lacks are marked [EN] and set left to right.
    const checked = page.getByTestId("numbers-checked");
    await expect(checked).toHaveText("[EN] Checked by the Hub, last updated September 30, 2026");
    await expect(checked).toHaveAttribute("dir", "ltr");
    // "Call" is English behind a fallback, so the call link reads as one English line with its number beside it.
    await expect(page.getByTestId("number-211-call")).toHaveAttribute("lang", "en");
    await expect(page.getByTestId("number-211-call")).toHaveAttribute("dir", "ltr");
    // The address of a building is an English, left-to-right run.
    await expect(page.getByTestId("building-contact-address").first().locator("bdi")).toHaveAttribute("dir", "ltr");
  });
});

test.describe("every Be ready page", () => {
  test("is public: no cookie, and a shared cache may keep it for a few minutes, in every launch language", async ({ request }) => {
    for (const path of ["/en/ready", "/en/ready/power", "/en/ready/numbers", "/ur/ready", "/zh/ready/heat", "/fr/ready/numbers"]) {
      const response = await request.get(path, { maxRedirects: 0 });

      expect(response.status(), path).toBe(200);
      expect(response.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie"), path).toEqual([]);
      expect(response.headers()["cache-control"], path).toBe("public, s-maxage=300, stale-while-revalidate=60");
    }
  });

  test("has the 911 block in the HTML the server sends, before any script runs", async ({ request }) => {
    for (const path of ["/en/ready", "/en/ready/power", "/en/ready/fire", "/en/ready/numbers", "/ur/ready/power", "/ur/ready/numbers"]) {
      const html = await (await request.get(path)).text();

      expect(html.match(/data-component="not-911"/g), path).toHaveLength(1);
    }
  });

  for (const path of [READY, POWER, NUMBERS, "/ur/ready/power", "/ur/ready/numbers"]) {
    for (const width of [320, 390, 768]) {
      test(`${path} has no horizontal scrolling at ${width}px`, async ({ page }) => {
        await chooseBuildings(page);
        await openResident(page, path, width);

        expect(await overflow(page)).toEqual({ page: 0, main: 0 });
      });
    }
  }
});

// Baseline screenshots: English and Urdu, at a phone's width and a desktop's. Taken in the pinned image only
// (npm run test:resident:update), the whole page each time.
for (const [name, path] of [
  ["ready", "/ready"],
  ["guide", "/ready/power"],
  ["numbers", "/ready/numbers"],
] as const) {
  for (const code of ["en", "ur"] as const) {
    for (const width of [390, 1280] as const) {
      test(`${name} page in ${code} at ${width}px matches its baseline screenshot`, async ({ page }) => {
        await chooseBuildings(page);
        await openResident(page, `/${code}${path}`, width, 900);
        if (name === "numbers") await expect(page.getByTestId("building-contact-card")).toHaveCount(2);
        await showWholePage(page, width);

        expect(await overflow(page)).toEqual({ page: 0, main: 0 });
        await expectBaseline(page, `ready-${name}-${code}-${width}.png`);
      });
    }
  }
}
