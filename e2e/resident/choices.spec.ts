import { expect, test, type Page } from "@playwright/test";
import { BUILDINGS, FLOOR, savedAtOf, savedChoices, seedChoices, stubBuildingList } from "./choices-fixture";
import { openResident } from "./helpers";

// S02.03: first-run choices that stay on the phone. Every test here starts as a first visit (empty storage) unless it
// seeds `cvh.choices` itself; the building list is answered by the test (there is no database behind this server).

test.use({ storageState: { cookies: [], origins: [] } });

const MILEPOST = BUILDINGS[0].rsn;
const DRIVE = BUILDINGS[1].rsn;
const OVERLEA = BUILDINGS[3].rsn;

const errorsOf = (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
};

test.describe("first visit", () => {
  test("shows R-01, then R-26 and R-35, each skippable, then home", async ({ page }) => {
    await stubBuildingList(page);
    const errors = errorsOf(page);

    await openResident(page, "/en", 390);
    await page.waitForURL("**/en/welcome");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose your language");

    await page.getByTestId("step-continue").click();
    await page.waitForURL("**/en/welcome/groups");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Which groups do you belong to?");
    await expect(page.getByTestId("step-skip")).toBeVisible();

    await page.getByTestId("step-skip").click();
    await page.waitForURL("**/en/welcome/place");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Get alerts for your building");
    await expect(page.getByTestId("step-skip")).toBeVisible();

    await page.getByTestId("step-skip").click();
    await page.waitForURL("**/en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Alerts now");

    // Skipping everything saves nothing but the language and that the steps were gone through.
    expect(await savedChoices(page)).toEqual({ v: 1, lang: "en", welcomed: true });
    expect(errors).toEqual([]);
  });

  test("does not ask again once the steps have been gone through, and opens home straight away", async ({ page }) => {
    await stubBuildingList(page);
    await seedChoices(page, JSON.stringify({ v: 1, lang: "en", welcomed: true }));

    await openResident(page, "/en", 390);
    await expect(page.getByTestId("first-run-gate")).toHaveAttribute("data-state", "ready");

    expect(new URL(page.url()).pathname).toBe("/en");
  });

  test("a language chosen in R-01 carries the rest of the steps in that language, mirrored for Urdu", async ({ page }) => {
    await stubBuildingList(page);

    await openResident(page, "/en/welcome", 390);
    await page.getByTestId("language-ur").check();
    await page.getByTestId("step-continue").click();
    await page.waitForURL("**/ur/welcome/groups");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ur");
    expect(await savedChoices(page)).toEqual({ v: 1, lang: "ur" });
  });

  test("R-26 saves the groups chosen, any number, on the phone", async ({ page }) => {
    await openResident(page, "/en/welcome/groups", 390);

    await page.getByTestId("group-seniors").check();
    await page.getByTestId("group-families").check();
    await page.getByTestId("group-seniors").uncheck();
    await page.getByTestId("group-newcomers").check();
    await page.getByTestId("step-continue").click();
    await page.waitForURL("**/en/welcome/place");

    expect(await savedChoices(page)).toEqual({ v: 1, groups: ["newcomers", "families"] });
  });
});

test.describe("R-35 where I live", () => {
  test("picks as many buildings as wanted and optional floors, saved by rsn and floor id; a unit number is never asked", async ({ page }) => {
    await stubBuildingList(page);
    await openResident(page, "/en/welcome/place", 390);

    await expect(page.getByTestId("building-options").locator("li[data-rsn]")).toHaveCount(BUILDINGS.length);
    await expect(page.getByTestId("chosen-count")).toHaveText("No buildings chosen yet");
    // No floor choices until a building is chosen.
    await expect(page.getByTestId(`floors-${MILEPOST}`)).toHaveCount(0);

    await page.getByTestId(`building-${MILEPOST}`).check();
    await page.getByTestId(`building-${DRIVE}`).check();
    await page.getByTestId(`building-${OVERLEA}`).check();
    await expect(page.getByTestId("chosen-count")).toHaveText("3 buildings chosen");
    await page.getByTestId(`floor-${FLOOR.milepost2}`).check();
    await page.getByTestId(`floor-${FLOOR.milepost3}`).check();
    await page.getByTestId(`floor-${FLOOR.drG}`).check();

    await expect(page.getByTestId("no-unit")).toHaveText("We never ask for your unit number here.");
    await expect(page.getByLabel(/unit/i)).toHaveCount(0);
    // The only text field is the search for a building.
    await expect(page.locator('input[type="text"], input[type="search"], input:not([type]), textarea')).toHaveCount(1);

    await page.getByTestId("step-continue").click();
    await page.waitForURL("**/en");

    expect(await savedChoices(page)).toEqual({
      v: 1,
      buildings: [MILEPOST, DRIVE, OVERLEA],
      floors: [FLOOR.milepost2, FLOOR.milepost3, FLOOR.drG],
      welcomed: true,
    });
  });

  test("unchoosing a building drops its floors, and search narrows the list without losing what is chosen", async ({ page }) => {
    await stubBuildingList(page);
    await openResident(page, "/en/choices/place", 390);

    await page.getByTestId(`building-${MILEPOST}`).check();
    await page.getByTestId(`floor-${FLOOR.milepost1}`).check();
    await page.getByTestId("building-search").fill("overlea");
    await expect(page.getByTestId("building-options").locator("li[data-rsn]")).toHaveCount(1);
    await page.getByTestId(`building-${OVERLEA}`).check();
    await page.getByTestId("building-search").fill("nowhere at all");
    await expect(page.getByTestId("no-match")).toHaveText('No building matches "nowhere at all".');
    await page.getByTestId("building-search").fill("");
    await page.getByTestId(`building-${MILEPOST}`).uncheck();
    await page.getByTestId(`building-${MILEPOST}`).check();
    await expect(page.getByTestId(`floor-${FLOOR.milepost1}`)).not.toBeChecked();
    await page.getByTestId(`floor-${FLOOR.milepost1}`).check();

    await page.getByTestId("step-save").click();
    await page.waitForURL("**/en/choices");

    expect(await savedChoices(page)).toEqual({ v: 1, buildings: [OVERLEA, MILEPOST], floors: [FLOOR.milepost1] });
  });

  test("a building with no floors listed says so, and the step can still be skipped when the list will not load", async ({ page }) => {
    await stubBuildingList(page);
    await openResident(page, "/en/welcome/place", 390);
    await page.getByTestId("building-700000099").check();
    await expect(page.getByTestId("floors-700000099")).toContainText("No floors are listed for this building yet.");

    const second = await page.context().newPage();
    await stubBuildingList(second, "unavailable");
    await openResident(second, "/en/welcome/place", 390);
    await expect(second.getByTestId("list-failed")).toBeVisible();
    await second.getByTestId("step-skip").click();
    await second.waitForURL("**/en");
  });
});

test.describe("R-34 what I have told the CVH", () => {
  const SAVED = { v: 1, lang: "en", welcomed: true, groups: ["seniors", "families"], buildings: [MILEPOST, OVERLEA], floors: [FLOOR.milepost2, FLOOR.overlea1] };

  test("lists every saved choice in plain words, each with change or remove", async ({ page }) => {
    await stubBuildingList(page);
    await seedChoices(page, JSON.stringify(SAVED));
    await openResident(page, "/en/choices", 390);

    await expect(page.getByTestId("told-language-value")).toHaveText("English");
    await expect(page.getByTestId(`told-building-row-${MILEPOST}`)).toContainText("4 Milepost Pl");
    await expect(page.getByTestId(`told-building-row-${MILEPOST}`)).toContainText("Thorncliffe Park");
    await expect(page.getByTestId(`told-floor-${FLOOR.milepost2}`)).toContainText("Floor 2");
    await expect(page.getByTestId(`told-building-row-${OVERLEA}`)).toContainText("10 Overlea Blvd");
    await expect(page.getByTestId(`told-floor-${FLOOR.overlea1}`)).toContainText("Floor 1");
    await expect(page.getByTestId("told-group-seniors")).toContainText("Seniors");
    await expect(page.getByTestId("told-group-families")).toContainText("Families with young children");
    await expect(page.getByTestId("on-device")).toHaveText("These choices are kept on this device only.");
    for (const id of ["change-language", "change-place", "change-groups", "clear-everything"]) await expect(page.getByTestId(id)).toBeVisible();
  });

  test("removes a group, a floor and a building one at a time, and says what was removed", async ({ page }) => {
    await stubBuildingList(page);
    await seedChoices(page, JSON.stringify(SAVED));
    await openResident(page, "/en/choices", 390);

    // Each item in a button's name is isolated with U+2068 and U+2069, so it reads right inside right-to-left text.
    await page.getByTestId("told-group-seniors").getByRole("button", { name: "Remove: ⁨Seniors⁩" }).click();
    await expect(page.getByTestId("removed-item")).toContainText("Removed: Seniors");
    expect((await savedChoices(page)).groups).toEqual(["families"]);

    await page.getByTestId(`told-floor-${FLOOR.milepost2}`).getByRole("button", { name: "Remove: ⁨4 Milepost Pl⁩, ⁨Floor 2⁩" }).click();
    expect((await savedChoices(page)).floors).toEqual([FLOOR.overlea1]);

    await page.getByTestId(`told-building-row-${OVERLEA}`).getByRole("button", { name: "Remove: ⁨10 Overlea Blvd⁩" }).click();
    expect(await savedChoices(page)).toEqual({ v: 1, lang: "en", welcomed: true, groups: ["families"], buildings: [MILEPOST], floors: [] });
    await expect(page.getByTestId(`told-building-${OVERLEA}`)).toHaveCount(0);
  });

  test("changes a group from R-34 and comes back", async ({ page }) => {
    await seedChoices(page, JSON.stringify(SAVED));
    await openResident(page, "/en/choices", 390);

    await page.getByTestId("change-groups").click();
    await page.waitForURL("**/en/choices/groups");
    await page.getByTestId("group-newcomers").check();
    await page.getByTestId("step-save").click();
    await page.waitForURL("**/en/choices");

    await expect(page.getByTestId("told-group-newcomers")).toBeVisible();
    expect((await savedChoices(page)).groups).toEqual(["seniors", "newcomers", "families"]);
  });

  test("changes the language from R-34", async ({ page }) => {
    await seedChoices(page, JSON.stringify(SAVED));
    await openResident(page, "/en/choices", 390);

    await page.getByTestId("change-language").click();
    await page.waitForURL("**/en/choices/language");
    await page.getByTestId("language-fr").check();
    await page.getByTestId("step-save").click();
    await page.waitForURL("**/fr/choices");

    await expect(page.getByTestId("told-language-value")).toHaveText("Français");
    expect((await savedChoices(page)).lang).toBe("fr");
    expect((await savedChoices(page)).buildings).toEqual([MILEPOST, OVERLEA]);
  });

  test('"Clear everything" removes cvh.choices and returns to R-01', async ({ page }) => {
    await stubBuildingList(page);
    await seedChoices(page, JSON.stringify(SAVED));
    await openResident(page, "/en/choices", 390);

    await page.getByTestId("clear-everything").click();
    await expect(page.getByTestId("clear-confirm")).toBeVisible();
    await page.getByTestId("clear-cancel").click();
    expect(await savedChoices(page)).not.toBeNull();

    await page.getByTestId("clear-everything").click();
    await page.getByTestId("clear-yes").click();
    await page.waitForURL("**/en/welcome");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose your language");
    expect(await page.evaluate(() => localStorage.getItem("cvh.choices"))).toBeNull();
    // Home is a first visit again.
    await page.goto("/en");
    await page.waitForURL("**/en/welcome");
  });

  test("nothing saved reads as nothing told", async ({ page }) => {
    await seedChoices(page, JSON.stringify({ v: 1, welcomed: true }));
    await openResident(page, "/en/choices", 390);

    await expect(page.getByTestId("nothing-yet")).toHaveText("You have not told the CVH anything yet.");
  });
});

test.describe("saved choices that no longer match the building list", () => {
  test("drops a building whose rsn is gone and a floor that no longer exists, says so on R-34, and loses nothing else", async ({ page }) => {
    await stubBuildingList(page);
    await seedChoices(
      page,
      JSON.stringify({
        v: 1,
        lang: "en",
        welcomed: true,
        groups: ["newcomers"],
        buildings: [MILEPOST, "999999999"],
        floors: [FLOOR.milepost1, FLOOR.gone],
        basic: true,
      }),
    );

    await openResident(page, "/en", 390);
    await expect(page.getByTestId("first-run-gate")).toHaveAttribute("data-state", "ready");
    await expect.poll(() => savedChoices(page)).toMatchObject({ buildings: [MILEPOST], floors: [FLOOR.milepost1] });

    expect(await savedChoices(page)).toEqual({
      v: 1,
      lang: "en",
      welcomed: true,
      groups: ["newcomers"],
      buildings: [MILEPOST],
      floors: [FLOOR.milepost1],
      basic: true,
      removed: { buildings: 1, floors: 1 },
    });

    await page.getByTestId("choices-link").click();
    await page.waitForURL("**/en/choices");
    const note = page.getByTestId("removed-note");
    await expect(note).toContainText("1 building you saved is no longer in the building list, so it was removed.");
    await expect(note).toContainText("1 floor you saved no longer exists, so it was removed.");
    await expect(note).toContainText("Everything else you chose is unchanged.");
    await expect(page.getByTestId("told-group-newcomers")).toBeVisible();
    await expect(page.getByTestId(`told-building-row-${MILEPOST}`)).toContainText("4 Milepost Pl");

    await page.getByTestId("removed-ok").click();
    await expect(note).toHaveCount(0);
    expect((await savedChoices(page)).removed).toBeUndefined();
  });

  test("never prunes with a list that is older than the last write: a building chosen since is kept", async ({ page }) => {
    // The list was read an hour ago; the choices were written just now, and name a building it does not have.
    await stubBuildingList(page, "list", new Date(Date.now() - 60 * 60 * 1000));
    const saved = { v: 1, lang: "en", welcomed: true, buildings: [MILEPOST, "999999999"], savedAt: Date.now() };
    await seedChoices(page, JSON.stringify(saved));

    await openResident(page, "/en/choices", 390);
    await expect(page.getByTestId(`told-building-row-${MILEPOST}`)).toContainText("4 Milepost Pl");
    await expect(page.getByTestId("told-building-row-999999999")).toContainText("Building 999999999");
    // The list has loaded (a building in it shows its address); give the check the chance it would take.
    await page.waitForTimeout(300);

    expect(await savedChoices(page)).toEqual({ v: 1, lang: "en", welcomed: true, buildings: [MILEPOST, "999999999"] });
    await expect(page.getByTestId("removed-note")).toHaveCount(0);
  });

  test("prunes with a list that is newer than the last write", async ({ page }) => {
    await stubBuildingList(page);
    await seedChoices(page, JSON.stringify({ v: 1, lang: "en", welcomed: true, buildings: [MILEPOST, "999999999"], savedAt: Date.now() - 60 * 60 * 1000 }));

    await openResident(page, "/en/choices", 390);

    await expect(page.getByTestId("removed-note")).toContainText("1 building you saved is no longer in the building list, so it was removed.");
    expect((await savedChoices(page)).buildings).toEqual([MILEPOST]);
    // Pruning is a write, and stamped as one.
    expect(await savedAtOf(page)).toBeGreaterThan(Date.now() - 60 * 1000);
  });

  test("every change stamps savedAt", async ({ page }) => {
    await stubBuildingList(page);
    const before = Date.now();
    await openResident(page, "/en/welcome/groups", 390);
    await page.getByTestId("group-seniors").check();
    await page.getByTestId("step-continue").click();
    await page.waitForURL("**/en/welcome/place");

    const at = await savedAtOf(page);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  test("removing a building builds the change from what is saved now, not from what the screen last drew", async ({ page }) => {
    await stubBuildingList(page);
    await seedChoices(page, JSON.stringify({ v: 1, lang: "en", welcomed: true, buildings: [MILEPOST, OVERLEA], floors: [FLOOR.milepost2] }));
    await openResident(page, "/en/choices", 390);
    await expect(page.getByTestId(`told-floor-${FLOOR.milepost2}`)).toBeVisible();

    // Another tab saves a third building and a floor of it; this tab is not told (a storage event is not sent to the tab that wrote).
    await page.evaluate(
      ([drive, floor]) => {
        const saved = JSON.parse(localStorage.getItem("cvh.choices")!);
        localStorage.setItem("cvh.choices", JSON.stringify({ ...saved, buildings: [...saved.buildings, drive], floors: [...saved.floors, floor] }));
      },
      [DRIVE, FLOOR.drG],
    );
    await page.getByTestId(`told-building-row-${OVERLEA}`).getByRole("button", { name: /^Remove: / }).click();

    expect(await savedChoices(page)).toEqual({ v: 1, lang: "en", welcomed: true, buildings: [MILEPOST, DRIVE], floors: [FLOOR.milepost2, FLOOR.drG] });
  });

  test("removing a floor and a group builds the change from what is saved now", async ({ page }) => {
    await stubBuildingList(page);
    await seedChoices(page, JSON.stringify({ v: 1, lang: "en", welcomed: true, groups: ["seniors", "families"], buildings: [MILEPOST], floors: [FLOOR.milepost1, FLOOR.milepost2] }));
    await openResident(page, "/en/choices", 390);
    await expect(page.getByTestId(`told-floor-${FLOOR.milepost2}`)).toBeVisible();

    await page.evaluate((floor) => {
      const saved = JSON.parse(localStorage.getItem("cvh.choices")!);
      localStorage.setItem("cvh.choices", JSON.stringify({ ...saved, groups: [...saved.groups, "newcomers"], floors: [...saved.floors, floor] }));
    }, FLOOR.milepost3);
    await page.getByTestId(`told-floor-${FLOOR.milepost1}`).getByRole("button", { name: /^Remove: / }).click();
    await page.getByTestId("told-group-seniors").getByRole("button", { name: /^Remove: / }).click();

    const after = await savedChoices(page);
    expect(after.floors).toEqual([FLOOR.milepost2, FLOOR.milepost3]);
    expect(after.groups).toEqual(["families", "newcomers"]);
  });

  test("removing the last building while the list could not be loaded takes the floors count with it", async ({ page }) => {
    await stubBuildingList(page, "unavailable");
    await seedChoices(page, JSON.stringify({ v: 1, lang: "en", welcomed: true, buildings: [MILEPOST], floors: [FLOOR.milepost1, FLOOR.milepost2] }));
    await openResident(page, "/en/choices", 390);
    await expect(page.getByTestId("told-place")).toContainText("2 floors chosen");

    await page.getByTestId(`told-building-row-${MILEPOST}`).getByRole("button", { name: /^Remove: / }).click();

    await expect(page.getByTestId("told-place")).toContainText("None chosen");
    await expect(page.getByTestId("told-place")).not.toContainText("floors chosen");
  });

  test("keeps everything when the building list cannot be loaded", async ({ page }) => {
    await stubBuildingList(page, "unavailable");
    const saved = { v: 1, lang: "en", welcomed: true, buildings: ["999999999"], floors: [FLOOR.gone] };
    await seedChoices(page, JSON.stringify(saved));

    await openResident(page, "/en/choices", 390);

    await expect(page.getByTestId("list-failed")).toBeVisible();
    await expect(page.getByTestId("told-building-row-999999999")).toContainText("Building 999999999");
    expect(await savedChoices(page)).toEqual(saved);
  });
});

test.describe("choices that are missing, corrupt or fail the schema", () => {
  for (const [name, raw] of [
    ["not JSON", "{oops"],
    ["a JSON value that is not an object", "[1,2]"],
    ["an unknown version", JSON.stringify({ v: 2, welcomed: true })],
  ] as const) {
    test(`${name} starts as a first visit and never throws`, async ({ page }) => {
      await stubBuildingList(page);
      const errors = errorsOf(page);
      await seedChoices(page, raw);

      await openResident(page, "/en", 390);
      await page.waitForURL("**/en/welcome");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose your language");
      await page.goto("/en/choices");
      await expect(page.getByTestId("nothing-yet")).toBeVisible();

      expect(errors).toEqual([]);
    });
  }

  test("a value that S02.02 saved, {v: 1, lang}, is a first visit that keeps the language", async ({ page }) => {
    await stubBuildingList(page);
    await seedChoices(page, JSON.stringify({ v: 1, lang: "ur" }));

    await openResident(page, "/ur", 390);
    await page.waitForURL("**/ur/welcome");

    await expect(page.locator("html")).toHaveAttribute("lang", "ur");
    expect(await savedChoices(page)).toEqual({ v: 1, lang: "ur" });
    await expect(page.getByTestId("language-ur")).toBeChecked();
  });

  test("one field of the wrong type is dropped on its own: the language and the rest are kept, and it is not a first visit", async ({ page }) => {
    await stubBuildingList(page);
    const errors = errorsOf(page);
    await seedChoices(page, JSON.stringify({ v: 1, lang: "ur", welcomed: true, buildings: [7], floors: ["2"], groups: ["pirates", "seniors"], basic: true }));

    await openResident(page, "/ur", 390);
    await expect(page.getByTestId("first-run-gate")).toHaveAttribute("data-state", "ready");
    expect(new URL(page.url()).pathname).toBe("/ur");

    await page.getByTestId("choices-link").click();
    await page.waitForURL("**/ur/choices");
    await expect(page.getByTestId("told-group-seniors")).toBeVisible();
    await expect(page.getByTestId("told-language-value")).toHaveText("اردو");
    expect(errors).toEqual([]);
  });

  test("a phone that keeps nothing is not sent through the first-run steps on every visit: home shows the link instead", async ({ page }) => {
    await stubBuildingList(page);
    const errors = errorsOf(page);
    await page.addInitScript(() => {
      const refuse = () => {
        throw new DOMException("blocked", "SecurityError");
      };
      Storage.prototype.getItem = refuse;
      Storage.prototype.setItem = refuse;
      Storage.prototype.removeItem = refuse;
    });

    await openResident(page, "/en", 390);
    await expect(page.getByTestId("first-run-gate")).toHaveAttribute("data-state", "ready");
    await expect(page.getByTestId("choices-link")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Alerts now");
    // Not sent anywhere, however long it is given.
    await page.waitForTimeout(500);
    expect(new URL(page.url()).pathname).toBe("/en");

    // The choices are still open to the resident, and kept for the open session.
    await page.getByTestId("choices-link").click();
    await page.waitForURL("**/en/choices");
    await page.getByTestId("change-groups").click();
    await page.waitForURL("**/en/choices/groups");
    await page.getByTestId("group-seniors").check();
    await page.getByTestId("step-save").click();
    await page.waitForURL("**/en/choices");
    await expect(page.getByTestId("told-group-seniors")).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe("right-to-left", () => {
  for (const lang of ["ur", "ps", "prs"]) {
    test(`${lang}: the steps and R-34 mirror and do not scroll sideways`, async ({ page }) => {
      await stubBuildingList(page);
      await seedChoices(page, JSON.stringify({ v: 1, lang, welcomed: true, groups: ["seniors"], buildings: [MILEPOST], floors: [FLOOR.milepost1] }));

      for (const path of ["/welcome", "/welcome/groups", "/welcome/place", "/choices"]) {
        await openResident(page, `/${lang}${path}`, 320);
        await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
        const overflow = await page.evaluate(() => ({
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          main: (document.querySelector('[data-testid="shell-main"]') as HTMLElement).scrollWidth - (document.querySelector('[data-testid="shell-main"]') as HTMLElement).clientWidth,
        }));
        expect(overflow, `${lang}${path}`).toEqual({ page: 0, main: 0 });
      }

      // The options start at the right edge: the control is at the inline start of its row.
      await openResident(page, `/${lang}/welcome/groups`, 390);
      const box = await page.getByTestId("group-seniors").locator("input").boundingBox();
      const row = await page.getByTestId("group-seniors").boundingBox();
      expect(box!.x + box!.width).toBeGreaterThan(row!.x + row!.width / 2);
    });

    test(`${lang}: an address, a neighbourhood and a floor label are isolated left-to-right runs inside the right-to-left text`, async ({ page }) => {
      await stubBuildingList(page);
      await seedChoices(page, JSON.stringify({ v: 1, lang, welcomed: true, groups: ["seniors"], buildings: [MILEPOST], floors: [FLOOR.milepost1] }));

      // R-35: the address and neighbourhood of each building, and the address in the heading of its floors.
      await openResident(page, `/${lang}/choices/place`, 390);
      const option = page.getByTestId(`building-${MILEPOST}`);
      await expect(option.locator('.choice-option__label bdi[lang="en"]')).toHaveAttribute("dir", "ltr");
      await expect(option.locator('.choice-option__label bdi[lang="en"]')).toHaveText("4 Milepost Pl");
      await expect(option.locator('.choice-option__line bdi[lang="en"]')).toHaveAttribute("dir", "ltr");
      await expect(option.locator('.choice-option__line bdi[lang="en"]')).toHaveText("Thorncliffe Park");
      await expect(page.getByTestId(`floors-${MILEPOST}`).locator("legend bdi").last()).toHaveAttribute("dir", "ltr");
      await expect(page.getByTestId(`floors-${MILEPOST}`).locator("legend bdi").last()).toHaveText("4 Milepost Pl");
      await expect(page.getByTestId(`floor-${FLOOR.milepost1}`).locator("bdi[dir=ltr]").last()).toHaveText("1");
      // What is typed in the search box takes the direction of its first strong letter.
      await expect(page.getByTestId("building-search")).toHaveAttribute("dir", "auto");

      // R-34: the same, and the buttons' names isolate their items.
      await openResident(page, `/${lang}/choices`, 390);
      const buildingRow = page.getByTestId(`told-building-row-${MILEPOST}`);
      await expect(buildingRow.locator('.choice-told__value bdi[lang="en"]')).toHaveAttribute("dir", "ltr");
      await expect(buildingRow.locator('.choice-told__value bdi[lang="en"]')).toHaveText("4 Milepost Pl");
      await expect(buildingRow.locator('.choice-hint bdi[lang="en"]')).toHaveAttribute("dir", "ltr");
      await expect(buildingRow.locator('.choice-hint bdi[lang="en"]')).toHaveText("Thorncliffe Park");
      await expect(page.getByTestId(`told-floor-${FLOOR.milepost1}`).locator(".choice-told__value bdi[dir=ltr]").last()).toHaveText("1");
      expect(await buildingRow.getByRole("button").getAttribute("aria-label")).toContain("⁨4 Milepost Pl⁩");
      expect(await page.getByTestId(`told-floor-${FLOOR.milepost1}`).getByRole("button").getAttribute("aria-label")).toMatch(/⁨4 Milepost Pl⁩, ⁨.*⁩/);
    });

    test(`${lang}: a saved item and its Remove stay on one line at 320px, and only the rows under the first have a rule above them`, async ({ page }) => {
      await stubBuildingList(page);
      await seedChoices(page, JSON.stringify({ v: 1, lang, welcomed: true, groups: ["seniors"], buildings: [MILEPOST], floors: [FLOOR.milepost1] }));
      await openResident(page, `/${lang}/choices`, 320);

      for (const id of [`told-building-row-${MILEPOST}`, `told-floor-${FLOOR.milepost1}`, "told-group-seniors"]) {
        const row = page.getByTestId(id);
        const words = await row.locator(":scope > div").first().boundingBox();
        const acts = await row.locator(".choice-told__acts").boundingBox();
        expect(acts!.y, id).toBeLessThan(words!.y + words!.height);
        expect(acts!.y + acts!.height, id).toBeGreaterThan(words!.y);
        // Side by side: the two boxes do not overlap across the row.
        expect(acts!.x + acts!.width <= words!.x + 0.5 || words!.x + words!.width <= acts!.x + 0.5, id).toBe(true);
      }
      const topBorder = (id: string) => page.getByTestId(id).evaluate((element) => getComputedStyle(element).borderBlockStartWidth);
      expect(await topBorder(`told-building-row-${MILEPOST}`)).toBe("0px");
      expect(await topBorder(`told-floor-${FLOOR.milepost1}`)).toBe("1px");
      expect(await topBorder("told-group-seniors")).toBe("1px");
    });
  }
});
