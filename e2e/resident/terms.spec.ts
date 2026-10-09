import { expect, test, type Page } from "@playwright/test";
import { ALERTS_URL, RESIDENT_DATA_DELETED_ON } from "./alerts-server";
import { HEIGHTS, LANGUAGES, WIDTHS, expectBaseline, openResident } from "./helpers";
import terms from "../../data/catalogue/terms.json";
import urduContent from "../../data/catalogue/translations/content/ur.json";

const termsTitle = "terms.title";
const urduTexts = urduContent.texts as Record<string, { text: string | null } | undefined>;
/** The committed Urdu translation of a terms text (data/catalogue/translations/content/ur.json). */
function urdu(key: string): string {
  const text = urduTexts[key]?.text;
  if (!text) throw new Error(`No Urdu translation of ${key}`);
  return text;
}

// S07.01: /{lang}/terms inside the resident shell. The committed terms are published: the owner reviewed the English and,
// for the pilot, waived counsel's review (data/catalogue/terms.json counselWaiver). The draft banner and the 404 of unpublished
// terms in production are covered by the unit tests of termsPageMode and termsRefusals.

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
    "we never share it or your agreement to get texts with anyone for marketing",
    "Message and data rates may apply. Reply HELP for help.",
  ]) {
    expect(text.toLowerCase(), phrase).toContain(phrase.toLowerCase());
  }
  // English has nothing standing in for a missing translation.
  await expect(page.locator("main bdi[lang='en'], main h1[lang], main h2[lang], main p.terms-line[lang]")).toHaveCount(0);
  await expect(page.getByTestId("terms-translation-note")).toHaveCount(0);

  await expect(page.getByTestId("terms-version")).toHaveText("2026-10-07.1");
  await expect(page.getByTestId("terms-updated")).toHaveText("2026-10-07");
  await expect(page.getByTestId("terms-owner")).toContainText("Helena Yu, Sprout Climate Association");
  await expect(page.getByTestId("terms-contact")).toContainText("helena.yu@sprout-climate.org");
  // No end-of-pilot purge has completed for this server: the page says nothing about deleted data (S09.08).
  await expect(page.getByTestId("terms-deleted")).toHaveCount(0);
  await expect(page.getByTestId("terms-deleted-note")).toHaveCount(0);
});

test("published terms are shown as final: no draft banner, and open to search", async ({ page }) => {
  await openResident(page, "/en/terms", 390);

  await expect(page.locator("main h1")).toHaveText("Terms and privacy");
  await expect(page.getByTestId("terms-draft")).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
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

test("/ur/terms is in Urdu, right to left: every text is its translation, with no English standing in and no note", async ({ page }) => {
  await openResident(page, "/ur/terms", 390);

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  // Under the pilot setting (CATALOGUE_PILOT_MACHINE_TRANSLATIONS, on) every current Urdu text whose facts match the English
  // is shown: each heading and paragraph is the committed translation, in order, inheriting the page's lang and dir.
  await expect(page.locator("main h1")).toHaveText(urdu(termsTitle));
  for (const section of terms.sections) {
    const block = page.getByTestId(`terms-section-${section.id}`);
    await expect(block.locator("h2")).toHaveText(urdu(`terms.${section.id}.heading`));
    await expect(block.locator("p.terms-line")).toHaveText(section.lines.map((_, index) => urdu(`terms.${section.id}.${index}`)));
  }
  await expect(page.locator("main h1, main h2")).toHaveCount(1 + terms.sections.length);
  await expect(page.locator("main :is(h1, h2, p.terms-line)[lang], main :is(h1, h2, p.terms-line)[dir]")).toHaveCount(0);
  await expect(page.locator("main :is(h1, h2, p.terms-line) bdi")).toHaveCount(0);
  await expect(page.getByTestId("terms-translation-note")).toHaveCount(0);
  // The rules the people reading it follow stay in Latin script, as in the English.
  const text = await page.getByTestId("terms").innerText();
  for (const word of ["STOP", "Twilio", "Cohere", "Vercel", "Supabase", "16"]) expect(text, word).toContain(word);
  // The version, the date and the contact are shown and are left-to-right runs inside the right-to-left page.
  await expect(page.getByTestId("terms-version")).toHaveText("2026-10-07.1");
  await expect(page.getByTestId("terms-updated")).toHaveText("2026-10-07");
  await expect(page.getByTestId("terms-contact")).toContainText("helena.yu@sprout-climate.org");
  for (const id of ["terms-version", "terms-updated", "terms-contact"]) await expect(page.getByTestId(id)).toHaveAttribute("dir", "ltr");
});

test("text starts at the edge its own direction says: English blocks at the left gutter, translated right-to-left blocks at the right", async ({ page }) => {
  // The edges of the text itself (a Range over it), not of its element: a block is as wide as the page whatever its alignment.
  const edges = async (path: string, selector: string, open = true) => {
    if (open) await openResident(page, path, 390);
    return page.evaluate((css) => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector(css)!);
      const text = range.getBoundingClientRect();
      const main = document.querySelector("main")!.getBoundingClientRect();
      return { fromLeft: text.left - main.left, fromRight: main.right - text.right };
    }, selector);
  };
  // Every text of the Urdu page is translated, so make an English stand-in the way the page renders one (src/ui/text,
  // ResidentText with fallback): a paragraph of the page's own, with English text and lang="en" dir="ltr" on the element itself.
  const englishStandIn = async () => {
    await openResident(page, "/ur/terms", 390);
    // Only once the page is hydrated: a node added before that is dropped when React takes over the server's HTML.
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => {
      const line = document.querySelector("main p.terms-line")!;
      const probe = line.cloneNode(false) as HTMLElement;
      probe.setAttribute("lang", "en");
      probe.setAttribute("dir", "ltr");
      probe.id = "english-probe";
      probe.textContent = "Reply STOP to any text from the Hub.";
      line.before(probe);
    });
    await expect(page.locator("#english-probe")).toBeAttached();
    return edges("/ur/terms#probe", "#english-probe", false);
  };
  const english = {
    heading: await edges("/en/terms", "main h2"),
    line: await edges("/en/terms", "main p.terms-line"),
  };
  const urduPage = {
    heading: await edges("/ur/terms", "main h2"),
    line: await edges("/ur/terms", "main p.terms-line"),
    standIn: await englishStandIn(),
  };
  const gutter = english.heading.fromLeft;
  expect(gutter).toBeGreaterThan(10);

  // Urdu's own text starts at the right gutter, the mirror of the English page.
  expect(Math.abs(urduPage.heading.fromRight - gutter)).toBeLessThanOrEqual(1);
  expect(Math.abs(urduPage.line.fromRight - english.line.fromLeft)).toBeLessThanOrEqual(1);
  // English standing in on the Urdu page starts at the left gutter, exactly where the English page starts.
  expect(Math.abs(urduPage.standIn.fromLeft - english.line.fromLeft)).toBeLessThanOrEqual(1);
  expect(urduPage.standIn.fromRight).toBeGreaterThan(gutter);
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

// S09.08: once the end-of-pilot purge has completed, the page states the day the pilot's resident data was deleted. The second server (alerts-server.ts) has
// that day (CVH_FAKE_RESIDENT_DATA_DELETED_ON, standing in for the purge's record in the database); the first server's page never shows it, as above.
const deletedLabel = (page: Page) => page.locator(".terms-facts__item", { has: page.getByTestId("terms-deleted") }).locator("dt");

test.describe("after the end-of-pilot purge", () => {
  test.use({
    baseURL: ALERTS_URL,
    storageState: { cookies: [], origins: [{ origin: ALERTS_URL, localStorage: [{ name: "cvh.choices", value: JSON.stringify({ v: 1, welcomed: true }) }] }] },
  });

  for (const language of LANGUAGES) {
    test(`/${language.code}/terms states the day resident data was deleted, in its own language`, async ({ page }) => {
      await openResident(page, `/${language.code}/terms`, 390);

      // The day is a left-to-right run, like the last-updated date, beside the facts; the sentence below them says what was deleted.
      await expect(page.getByTestId("terms-deleted")).toHaveText(RESIDENT_DATA_DELETED_ON);
      await expect(page.getByTestId("terms-deleted")).toHaveAttribute("dir", "ltr");
      const note = page.getByTestId("terms-deleted-note");
      await expect(note).toBeVisible();
      await expect(note).toContainText("CVH");
      // Translated in every language: no English stands in for it.
      await expect(note).not.toHaveAttribute("lang", "en");
      expect(await note.innerText()).not.toMatch(/^\[EN\]/);
      await expect(deletedLabel(page)).not.toHaveAttribute("lang", "en");
    });
  }

  test("the English page says it in plain words", async ({ page }) => {
    await openResident(page, "/en/terms", 390);

    await expect(deletedLabel(page)).toHaveText("Resident data deleted");
    await expect(page.getByTestId("terms-deleted-note")).toHaveText(
      "The CVH pilot has ended. On that date we deleted the phone number and choices of everyone who did not reply YES to keep getting alerts.",
    );
  });

  for (const code of ["en", "ur"]) {
    for (const width of WIDTHS) {
      test(`/${code}/terms after the purge matches its baseline screenshot at ${width}px`, async ({ page }) => {
        await openResident(page, `/${code}/terms`, width);
        await showWholePage(page, width);

        await expectBaseline(page, `terms-deleted-${code}-${width}.png`);
      });
    }
  }
});
