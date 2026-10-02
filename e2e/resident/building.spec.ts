import { expect, test, type Page } from "@playwright/test";
import { expectBaseline, openResident } from "./helpers";

// S02.08: the building page (/{lang}/buildings/{rsn}) in the resident shell. The server runs with
// CVH_FAKE_BUILDINGS_FILE (playwright.resident.config.ts), so these three sample buildings stand in for the database:
//   4154146  every fact known, a Hub contact entered on 2026-09-30
//   4154159  storeys, elevators, emergency power, air conditioning and barrier-free entrance not known; no cooling room;
//            no contact
//   4154169  no longer in the latest register (the Hub is checking its details)
// Every fixture date is on or before 2026-10-01.

const FULL = "/en/buildings/4154146";
const UNKNOWNS = "/en/buildings/4154159";
const CHECKING = "/en/buildings/4154169";

/** Grows the viewport to the whole page, so the baseline shows every fact and the contact, not the first screen. */
async function showWholePage(page: Page, width: number) {
  const needed = await page.evaluate(() => {
    const main = document.querySelector("main")!;
    const around = document.documentElement.clientHeight - main.clientHeight;
    return Math.ceil(main.scrollHeight + around);
  });
  await page.setViewportSize({ width, height: needed });
}

const factValue = (page: Page, id: string) => page.getByTestId(`fact-${id}`).locator("dd");

test("shows the six register facts, the day they last changed, and the Hub's contact with its owner and date", async ({ page }) => {
  const response = await openResident(page, FULL, 390);

  expect(response!.status()).toBe(200);
  await expect(page.locator("main h1")).toHaveText("4 Milepost Pl");
  await expect(page.getByTestId("building-updated")).toHaveText("Last updated September 28, 2026");
  const rows = await page.locator(".building-fact").evaluateAll((items) => items.map((item) => [item.querySelector("dt")!.textContent, item.querySelector("dd")!.textContent?.trim()]));
  expect(rows).toEqual([
    ["Storeys", "6"],
    ["Elevators", "2"],
    ["Emergency power", "Yes"],
    ["Cooling room", "No"],
    ["Air conditioning", "None"],
    ["Barrier-free entrance", "Yes"],
  ]);
  await expect(page.getByTestId("building-contact-role")).toHaveText("Superintendent");
  await expect(page.getByTestId("building-contact-provided")).toHaveText("Provided by the Hub, last updated September 30, 2026");
  await expect(page.getByTestId("building-call")).toHaveAttribute("href", "tel:+14165550123");
  await expect(page.getByTestId("building-call")).toContainText("(416) 555-0123");
  // In English the button needs no override: it takes the page's language and direction.
  await expect(page.getByTestId("building-call")).not.toHaveAttribute("lang");
  await expect(page.getByTestId("building-call")).not.toHaveAttribute("dir");
  await expect(page.getByTestId("building-checking")).toHaveCount(0);
});

test("never shows No and Not known the same way: different words, different marks, different style", async ({ page }) => {
  await openResident(page, UNKNOWNS, 390);

  const no = factValue(page, "coolingRoom").locator(".building-value");
  const unknown = factValue(page, "emergencyPower").locator(".building-value");
  await expect(no).toHaveText("No");
  await expect(unknown).toHaveText("Not known");
  for (const id of ["storeys", "elevators", "emergencyPower", "airConditioning", "barrierFree"]) {
    await expect(factValue(page, id), id).toHaveText("Not known");
  }

  const look = (locator: typeof no) =>
    locator.evaluate((element) => {
      const mark = getComputedStyle(element.querySelector(".building-value__mark")!);
      const own = getComputedStyle(element);
      return { markStyle: mark.borderTopStyle, markFill: mark.backgroundColor, fontStyle: own.fontStyle };
    });
  const [noLook, unknownLook] = [await look(no), await look(unknown)];
  expect(noLook).not.toEqual(unknownLook);
  expect(noLook.markStyle).toBe("solid");
  expect(unknownLook.markStyle).toBe("dashed");
  expect(unknownLook.fontStyle).toBe("italic");
  expect(noLook.fontStyle).toBe("normal");
  // Zero elevators is a fact, not a gap.
  await openResident(page, CHECKING, 390);
  await expect(factValue(page, "elevators")).toHaveText("0");
});

test("a building with no contact entered shows Not known where the contact would be", async ({ page }) => {
  await openResident(page, UNKNOWNS, 390);

  await expect(page.getByTestId("contact-unknown")).toHaveText("Not known");
  await expect(page.getByTestId("building-call")).toHaveCount(0);
  await expect(page.getByTestId("building-contact-provided")).toHaveCount(0);
});

test("a building that is not in the latest register still opens, with a note that the Hub is checking its details", async ({ page }) => {
  const response = await openResident(page, CHECKING, 390);

  expect(response!.status()).toBe(200);
  await expect(page.getByTestId("building-checking")).toHaveText("The Hub is checking this building's details. What you see here may change.");
  await expect(page.getByTestId("building-checking")).toHaveAttribute("role", "note");
  await expect(factValue(page, "airConditioning")).toHaveText("Individual units");
});

test("a building that does not exist is a 404 inside the shell, and a number that is not one too", async ({ page }) => {
  for (const path of ["/en/buildings/999", "/en/buildings/abc", "/ur/buildings/1; drop table building"]) {
    const response = await openResident(page, path, 390);

    expect(response!.status(), path).toBe(404);
    await expect(page.getByTestId("shell-nav"), path).toBeVisible();
    await expect(page.locator("main h1"), path).toContainText("This page could not be found.");
  }
});

test("is public and cacheable: no cookie, and a shared cache may keep it for a few minutes", async ({ request }) => {
  const response = await request.get(FULL, { maxRedirects: 0 });

  expect(response.status()).toBe(200);
  expect(response.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie")).toEqual([]);
  // Five minutes in a shared cache and one more served stale while it refreshes: a saved change reaches everyone in about 6 minutes.
  expect(response.headers()["cache-control"]).toBe("public, s-maxage=300, stale-while-revalidate=60");
});

test("shows only the facts the story lists: no coordinates, no floors, nobody who confirmed anything", async ({ page }) => {
  await openResident(page, FULL, 390);

  const text = (await page.locator("main").innerText()).toLowerCase();
  for (const word of ["latitude", "longitude", "floor", "confirmed", "rsn", "4154146", "43.7"]) expect(text, word).not.toContain(word);
});

test("a right-to-left page keeps its direction, and English text in it stays a left-to-right run", async ({ page }) => {
  await openResident(page, "/ur/buildings/4154146", 390);

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ur");
  // Strings Urdu does not have yet are English behind [EN], as an isolated left-to-right block; the date is English too.
  const updated = page.getByTestId("building-updated");
  await expect(updated).toHaveText("[EN] Last updated September 28, 2026");
  await expect(updated).toHaveAttribute("lang", "en");
  await expect(updated).toHaveAttribute("dir", "ltr");
  // Yes, No and Not known are translated already, so they are not marked.
  await expect(factValue(page, "emergencyPower")).not.toContainText("[EN]");
  await expect(factValue(page, "emergencyPower")).not.toHaveText(await factValue(page, "coolingRoom").innerText());
  // The phone number is a left-to-right run.
  await expect(page.getByTestId("building-call").locator("bdi").last()).toHaveText("(416) 555-0123");
  // The role is a translated label; Urdu has none yet, so it is English behind [EN], as its own left-to-right block.
  const role = page.getByTestId("building-contact-role");
  await expect(role).toHaveText("[EN] Superintendent");
  await expect(role).toHaveAttribute("lang", "en");
  await expect(role).toHaveAttribute("dir", "ltr");
  // "Call" fell back to English too, so the whole button is English and left to right: its words and the number read as one line.
  await expect(page.getByTestId("building-call")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("building-call")).toHaveAttribute("dir", "ltr");
  // The neighbourhood's name is an isolated run.
  await expect(page.locator(".building-neighbourhood bdi")).toHaveText("Thorncliffe Park");
});

for (const [code, path, name] of [
  ["en", FULL, "full"],
  ["ur", "/ur/buildings/4154146", "full"],
  ["en", UNKNOWNS, "unknown"],
  ["ur", "/ur/buildings/4154159", "unknown"],
  ["en", CHECKING, "checking"],
] as const) {
  for (const width of [390, 1280] as const) {
    test(`${code} ${name} building page at ${width}px has no horizontal scrolling and matches its baseline screenshot`, async ({ page }) => {
      await openResident(page, path, width, 900);
      await showWholePage(page, width);

      const overflow = await page.evaluate(() => {
        const main = document.querySelector("main")!;
        return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, main: main.scrollWidth - main.clientWidth };
      });
      expect(overflow).toEqual({ page: 0, main: 0 });
      await expectBaseline(page, `building-${code}-${name}-${width}.png`);
    });
  }
}

for (const width of [320, 768] as const) {
  test(`the page has no horizontal scrolling at ${width}px in a right-to-left language`, async ({ page }) => {
    await openResident(page, "/ur/buildings/4154146", width);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
  });
}
