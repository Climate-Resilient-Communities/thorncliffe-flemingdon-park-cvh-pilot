import { expect, test, type Page } from "@playwright/test";
import { HEIGHTS, LANGUAGES, WIDTHS, expectBaseline, openResident } from "./helpers";

// S07.01: /{lang}/terms inside the resident shell. Run against a local build (not production), so the terms, which are
// still a draft (owner, privacy contact and counsel's review are placeholders), are shown under the draft banner
// instead of being a 404; the 404 in production is covered by the unit tests of termsPageMode.

/** Grows the viewport to the whole page, so a baseline shows every line and not only the first screen. */
async function showWholePage(page: Page, width: number) {
  const extra = await page.evaluate(() => {
    const main = document.querySelector("main")!;
    return main.scrollHeight - main.clientHeight;
  });
  await page.setViewportSize({ width, height: HEIGHTS[width as keyof typeof HEIGHTS] + Math.max(extra, 0) });
}

const SECTIONS = ["keep", "who", "owns", "stop", "age", "messages", "contact"];

test("/en/terms states in plain words everything the terms must say, with version, owner and date", async ({ page }) => {
  const response = await openResident(page, "/en/terms", 390);

  expect(response!.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("main h1")).toHaveText("Terms and privacy");
  for (const id of SECTIONS) await expect(page.getByTestId(`terms-section-${id}`)).toBeVisible();

  const text = await page.getByTestId("terms").innerText();
  for (const phrase of [
    "your phone number",
    "your language",
    "your neighbourhood",
    "We do not ask for your name. We do not ask for your unit number, your email or a password. We do not keep them.",
    "Twilio",
    "Cohere",
    "Vercel",
    "Supabase",
    "Montreal",
    "The database is in Canada",
    "The community owns the data",
    "Reply STOP to any text from the Hub. Or reply 0, then reply 0 again to confirm.",
    "we delete your subscription",
    "You must be 16 or older to sign up.",
    "parent or guardian",
    "privacy contact",
    "Hub staff check every alert before it is sent.",
    "may not be sent overnight",
  ]) {
    expect(text.toLowerCase(), phrase).toContain(phrase.toLowerCase());
  }
  // English has nothing standing in for a missing translation.
  await expect(page.locator("main bdi[lang='en']")).toHaveCount(0);
  await expect(page.getByTestId("terms-translation-note")).toHaveCount(0);

  await expect(page.getByTestId("terms-version")).toHaveText("2026-10-02.1");
  await expect(page.getByTestId("terms-updated")).toHaveText("2026-10-02");
  await expect(page.getByTestId("terms-owner")).toContainText("PLACEHOLDER");
  await expect(page.getByTestId("terms-contact")).toContainText("PLACEHOLDER");
});

test("terms that are not published are never shown as final: the page is marked as a draft, and kept from search", async ({ page }) => {
  await openResident(page, "/en/terms", 390);

  const banner = page.getByTestId("terms-draft");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Draft: not yet published");
  await expect(banner).toContainText("not the final terms");
  // The banner comes first, before the title, and says why.
  const order = await page.evaluate(() => {
    const banner = document.querySelector('[data-testid="terms-draft"]')!.getBoundingClientRect();
    const title = document.querySelector("main h1")!.getBoundingClientRect();
    return banner.top < title.top;
  });
  expect(order).toBe(true);
  await expect(banner.locator("li").filter({ hasText: "the owner is still a placeholder" })).toHaveCount(1);
  await expect(banner.locator("li").filter({ hasText: "counsel review" }).first()).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

for (const language of LANGUAGES) {
  test(`/${language.code}/terms is a page in the ${language.code} shell`, async ({ page }) => {
    const response = await openResident(page, `/${language.code}/terms`, 390);

    expect(response!.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", language.bcp47);
    await expect(page.locator("html")).toHaveAttribute("dir", language.dir);
    await expect(page.getByTestId("shell-nav")).toBeVisible();
    for (const id of SECTIONS) await expect(page.getByTestId(`terms-section-${id}`)).toBeVisible();
    // The rules the people reading it follow: STOP and the processors stay in Latin script in every language.
    const text = await page.getByTestId("terms").innerText();
    for (const word of ["STOP", "Twilio", "Cohere", "Vercel", "Supabase"]) expect(text, word).toContain(word);
  });

  for (const width of WIDTHS) {
    test(`/${language.code}/terms has no horizontal scrolling at ${width}px`, async ({ page }) => {
      await openResident(page, `/${language.code}/terms`, width);

      const overflow = await page.evaluate(() => {
        const main = document.querySelector("main")!;
        return {
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          body: document.body.scrollWidth - document.documentElement.clientWidth,
          main: main.scrollWidth - main.clientWidth,
        };
      });
      expect(overflow).toEqual({ page: 0, body: 0, main: 0 });
    });
  }
}

test("a translation that is not available shows in English, marked and isolated as an English run, inside a right-to-left page", async ({ page }) => {
  await openResident(page, "/ur/terms", 390);

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  // Nothing is translated or reviewed yet, so every text of the terms is English standing in.
  const runs = page.locator("main h1 > bdi, main h2 > bdi, main p.terms-line > bdi");
  const count = await runs.count();
  expect(count).toBeGreaterThan(20);
  for (let index = 0; index < count; index += 1) {
    const run = runs.nth(index);
    await expect(run).toHaveAttribute("lang", "en");
    await expect(run).toHaveAttribute("dir", "ltr");
    expect(await run.innerText()).toMatch(/^\[EN\] /);
  }
  await expect(page.locator("main h1 > bdi")).toHaveText("[EN] Terms and privacy");
  // The page's own words are Urdu's, and the note says that some of the page is in English.
  await expect(page.getByTestId("terms-translation-note")).toBeVisible();
  // The facts that are not words (version, date, contact) are left-to-right runs.
  for (const id of ["terms-version", "terms-updated", "terms-contact"]) await expect(page.getByTestId(id)).toHaveAttribute("dir", "ltr");
});

test("the right-to-left page starts its text at the right edge, the left-to-right page at the left", async ({ page }) => {
  const edges = async (path: string) => {
    await openResident(page, path, 390);
    return page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const heading = box("main h2");
      const main = box("main");
      return { fromStart: heading.left - main.left, fromEnd: main.right - heading.right, width: main.width };
    });
  };
  const english = await edges("/en/terms");
  const urdu = await edges("/ur/terms");

  expect(Math.abs(urdu.fromEnd - english.fromStart)).toBeLessThanOrEqual(1);
});

for (const code of ["en", "ur"]) {
  for (const width of WIDTHS) {
    test(`/${code}/terms matches its baseline screenshot at ${width}px`, async ({ page }) => {
      await openResident(page, `/${code}/terms`, width);
      await showWholePage(page, width);

      await expectBaseline(page, `terms-${code}-${width}.png`);
    });
  }
}
