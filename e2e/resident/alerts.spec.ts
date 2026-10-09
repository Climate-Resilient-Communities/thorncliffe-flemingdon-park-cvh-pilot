import { expect, test, type Page } from "@playwright/test";
import { FeedV1 } from "../../src/contracts/feed";
import { LAUNCH_LANGUAGES } from "../../src/i18n/languages";
import { ALERTS_URL } from "./alerts-server";
import { PUBLIC_ORIGIN } from "./public-origin";
import { catalogText, expectBaseline, isFallback, openResident, wholePageHeight } from "./helpers";

// S04.08: alert detail (R-07), what "verified" means (R-28) and the alert cards on home (R-03), against the production build with the feed's
// threads read from fixtures/feed.json (CVH_FAKE_FEED_FILE; the second server of playwright.resident.config.ts, so no other test sees an alert).
// The feed's clock is fixed in that file (2026-10-01 15:00 UTC, 11:00 in Toronto), so every "ago" and "valid until" reads the same every day.
//   kbcdfghj  elevator: an acknowledgement (every language but English translated) and an update (translated into Urdu only, Pashto failed)
//   mnpqrstv  power and heat, not yet verified, no translation: English everywhere else
//   xyzw2345  other: its valid-until has passed and nothing has closed it yet
//   qrstvwxz  power: an acknowledgement that a correction replaced and an update that a withdrawal replaced (S05.02), the oldest news so the order of the others is what it was
//   rslvdabc  power: closed resolved, with its final message (S05.03); not in the feed, which lists open threads only, but opened from its address
//   expdabcd  other: closed expired (S05.03)
//   wthdrabc  power: closed withdrawn, the acknowledgement withdrawn with a reason (S05.03)

test.use({
  baseURL: ALERTS_URL,
  storageState: { cookies: [], origins: [{ origin: ALERTS_URL, localStorage: [{ name: "cvh.choices", value: JSON.stringify({ v: 1, welcomed: true }) }] }] },
});

const T1 = "kbcdfghj";
const T2 = "mnpqrstv";
const T3 = "xyzw2345";
const T4 = "qrstvwxz";
const RESOLVED = "rslvdabc";
const EXPIRED = "expdabcd";
const WITHDRAWN = "wthdrabc";
const FINAL = "Power is back on all floors. If your power is still out, call Toronto Hydro at 416-542-8000.";
const CORRECTION = "Power is out on floors 1 to 8 at 40 Gateway Blvd, not floors 1 to 6. We are finding out why.";
const WITHDRAWN_ACK = "Power is out on floors 1 to 6 at 40 Gateway Blvd. We are finding out why.";
const WITHDRAWAL_REASON = "This alert had wrong information. It has been withdrawn.";
const UPDATE = "Update: a technician is on site and the elevator should be working again by 6 pm.";
const ACK_EN = "The elevator at 85 Thorncliffe Park Dr is out of service. Please use the stairs and call the Hub if you need help.";

const noCookie = (response: { headersArray(): { name: string }[] }) => response.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie");

/** Grows the viewport to the whole page, so the baseline shows the whole alert, not the first screen. */
async function showWholePage(page: Page, width: number) {
  const needed = await wholePageHeight(page);
  await page.setViewportSize({ width, height: needed });
}

/**
 * The tap rule for what the page itself draws (the shell's closed language sheet has links of no size): every visible link, button and disclosure
 * summary of the main area is at least --tap-current (44 px, 56 px in basic mode) in both dimensions.
 */
const tapViolations = (page: Page) =>
  page.evaluate(() => {
    const minimum = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tap-current"));
    return [...document.querySelectorAll<HTMLElement>("main a[href], main button, main summary")]
      .filter((element) => element.checkVisibility())
      .filter((element) => {
        const { width, height } = element.getBoundingClientRect();
        return width < minimum || height < minimum;
      })
      .map((element) => element.outerHTML.slice(0, 80));
  });

const overflow = (page: Page) => page.evaluate(() => ({ page: document.documentElement.scrollWidth - document.documentElement.clientWidth, main: document.querySelector("main")!.scrollWidth - document.querySelector("main")!.clientWidth }));

test.describe("the feed with alerts", () => {
  test("lists the open threads in the language asked for, a valid FeedV1, with no cookie and a 15-second edge cache", async ({ request }) => {
    const response = await request.get("/api/feed?lang=ur", { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    expect(noCookie(response)).toEqual([]);
    expect(response.headers()["cache-control"]).toBe("public, max-age=0, s-maxage=15");
    const feed = FeedV1.parse(await response.json());
    expect(feed.feed_version).toBe(7);
    expect(feed.server_now).toBe("2026-10-01T15:00:00.000Z");
    expect(feed.threads.map((thread) => thread.slug)).toEqual([T1, T2, T3, T4]);
    const [elevator] = feed.threads;
    expect(elevator.entries.map((entry) => [entry.kind, entry.phase, entry.verified, entry.attribution])).toEqual([
      ["ack", "problem", true, { role: "hub" }],
      ["update", "in_progress", true, { role: "hub" }],
    ]);
    expect(elevator.entries[0].text).toMatchObject({ lang: "ur", machine: true, status: "ok" });
    expect(elevator.entries[0].original).toEqual({ lang: "en", body: ACK_EN });
  });

  test("gives English its own text as the source, and a language that has no text the English with fallback_en", async ({ request }) => {
    const english = FeedV1.parse(await (await request.get("/api/feed?lang=en")).json());
    expect(english.threads[0].entries[0].text).toMatchObject({ lang: "en", body: ACK_EN, status: "source", machine: false, model: null });

    const tagalog = FeedV1.parse(await (await request.get("/api/feed?lang=tl")).json());
    expect(tagalog.threads[0].entries[1].text).toMatchObject({ lang: "tl", body: UPDATE, status: "fallback_en", machine: false });
    const pashto = FeedV1.parse(await (await request.get("/api/feed?lang=ps")).json());
    expect(pashto.threads[0].entries[1].text).toMatchObject({ lang: "ps", body: UPDATE, status: "fallback_en" });
  });
});

test.describe("home", () => {
  test("shows each alert as a card with its types, words, origin, verification and time, and the whole card opens the alert", async ({ page }) => {
    await openResident(page, "/en", 390);
    await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "ready");

    const cards = page.getByTestId("home-threads").locator("li");
    await expect(cards).toHaveCount(4);
    const first = page.getByTestId(`alert-card-${T1}`);
    await expect(first.getByTestId("alert-types")).toContainText("Elevator");
    await expect(first.getByTestId(`alert-card-text-${T1}`)).toHaveText(UPDATE);
    await expect(first.getByTestId("alert-attribution")).toHaveText("Community alert from the Hub");
    await expect(first.getByTestId("alert-verification")).toHaveText("Verified by the Hub");
    await expect(first).toContainText("Updated 20 minutes ago");
    await expect(first).toHaveAttribute("href", `/en/alerts/${T1}`);
    // Power and heat, and not yet verified: words, not colour alone.
    const second = page.getByTestId(`alert-card-${T2}`);
    await expect(second.getByTestId("alert-types")).toContainText("Power");
    await expect(second.getByTestId("alert-types")).toContainText("Heat");
    await expect(second.getByTestId("alert-verification")).toHaveText("Not yet verified");
    await expect(second.getByTestId("alert-origin")).toHaveAttribute("data-verified", "false");
    // The statuses of the places are S05.06's: until then every place is "none", and "No current alerts" is never shown over a card.
    await expect(page.getByTestId("no-current-alerts")).toHaveCount(0);

    await first.click();
    await expect(page).toHaveURL(`${ALERTS_URL}/en/alerts/${T1}`);
    await expect(page.getByTestId("alert-detail")).toBeVisible();
  });

  test("sets an English text that stands in for a translation left to right in English, and says so once in the page's language", async ({ page }) => {
    await openResident(page, "/tl", 390);
    await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "ready");

    const text = page.getByTestId(`alert-card-text-${T1}`);
    await expect(text).toHaveText(UPDATE);
    await expect(text).toHaveAttribute("lang", "en");
    await expect(text).toHaveAttribute("dir", "ltr");
    await expect(text).toHaveAttribute("data-translation", "unavailable");
    await expect(page.getByTestId("home-content-fallback")).toBeVisible();
    await expect(page.getByTestId("home-content-fallback")).toContainText(catalogText("tl", "x04.unavailable").replace(/^\[EN\] /, ""));
  });

  for (const lang of ["en", "ur"] as const) {
    test(`${lang}: the alert cards at 390px have no horizontal scrolling and match their baseline screenshot`, async ({ page }) => {
      await openResident(page, `/${lang}`, 390, 900);
      await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "ready");
      await expect(page.getByTestId(`alert-card-${T1}`)).toBeVisible();
      await showWholePage(page, 390);

      expect(await overflow(page)).toEqual({ page: 0, main: 0 });
      expect(await tapViolations(page)).toEqual([]);
      await expectBaseline(page, `alerts-home-${lang}-390.png`);
    });
  }
});

test.describe("alert detail (R-07)", () => {
  test("shows the types, the words, the origin and verification with a link to what it means, when it was posted and how long it is valid, in English", async ({ page }) => {
    const response = await openResident(page, `/en/alerts/${T1}`, 390);

    expect(response!.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Elevator");
    await expect(page.getByTestId("alert-type-elevator").locator(".alert-ico")).toBeVisible();
    await expect(page.getByTestId("alert-text")).toHaveText(UPDATE);
    await expect(page.getByTestId("alert-attribution")).toHaveText("Community alert from the Hub");
    await expect(page.getByTestId("alert-whatmeans")).toContainText("Verified by the Hub");
    await expect(page.getByTestId("alert-whatmeans")).toContainText("What this means");
    await expect(page.getByTestId("alert-whatmeans")).toHaveAttribute("href", `/en/alerts/${T1}/verified`);
    await expect(page.getByTestId("alert-times")).toHaveText("Posted 1 hour ago · Updated 20 minutes ago");
    // The feed's clock says 11:00 in Toronto and the alert is valid until 18:00 that day.
    await expect(page.getByTestId("alert-valid")).toHaveText(/^Valid until today at 6:00\s?PM$/);
    // English needs no label and has no other text to show.
    await expect(page.getByTestId("alert-mt")).toHaveCount(0);
    await expect(page.getByTestId("alert-unavailable")).toHaveCount(0);
  });

  test("lists the thread newest first, with the latest marked", async ({ page }) => {
    await openResident(page, `/en/alerts/${T1}`, 390);

    const entries = page.getByTestId("alert-thread").locator("li");
    await expect(entries).toHaveCount(2);
    await expect(entries.nth(0)).toContainText("Update");
    await expect(entries.nth(0)).toContainText("Latest");
    await expect(entries.nth(0)).toContainText(UPDATE);
    await expect(entries.nth(1)).toContainText("First message");
    await expect(entries.nth(1)).toContainText(ACK_EN);
  });

  test("has the not-911 statement and the 911 block once, and a link to the matching guide opened at During", async ({ page }) => {
    await openResident(page, `/en/alerts/${T1}`, 390);

    await expect(page.locator('[data-component="not-911"]')).toHaveCount(1);
    await expect(page.locator('[data-component="not-911"]')).toContainText("The CVH is not an emergency service.");
    await expect(page.locator('[data-component="not-911"]')).toContainText("If someone is in danger, call 911.");
    const guide = page.getByTestId("alert-guide-elevator");
    await expect(guide).toHaveAttribute("href", "/en/ready/elevator#during");
    await expect(guide).toContainText("What to do: the elevator failure guide");

    await guide.click();
    await expect(page).toHaveURL(`${ALERTS_URL}/en/ready/elevator#during`);
    // The guide opens at "During", with the focus on that heading and the note that says why (S02.10).
    await expect(page.getByTestId("guide-opened-during")).toBeVisible();
    await expect(page.locator("#during-heading")).toBeFocused();
  });

  test("links an alert of the type Other to no guide", async ({ page }) => {
    await openResident(page, `/en/alerts/${T3}`, 390);

    await expect(page.getByTestId("alert-actions")).toHaveCount(0);
    await expect(page.locator('a[href*="/ready/"]')).toHaveCount(0);
    await expect(page.locator('[data-component="not-911"]')).toHaveCount(1);
  });

  test("links to what verified means, and back", async ({ page }) => {
    await openResident(page, `/en/alerts/${T1}`, 390);

    await page.getByTestId("alert-whatmeans").click();
    await expect(page).toHaveURL(`${ALERTS_URL}/en/alerts/${T1}/verified`);
    await expect(page.getByTestId("verified-explainer")).toBeVisible();
    await page.getByTestId("verified-back-button").click();
    await expect(page).toHaveURL(`${ALERTS_URL}/en/alerts/${T1}`);
  });

  test("marks an alert that is not yet verified in words, in shape and in its icon, and a fallback text in English with the note", async ({ page }) => {
    await openResident(page, `/en/alerts/${T2}`, 390);

    await expect(page.getByTestId("alert-verification")).toHaveText("Not yet verified");
    await expect(page.getByTestId("alert-origin")).toHaveAttribute("data-verified", "false");
    await expect(page.locator(".alert-verify--unverified .alert-ico--unverified")).toBeVisible();
    await expect(page.locator(".alert-verify--verified")).toHaveCount(0);
    await expect(page.getByTestId("alert-types")).toContainText("Power");
    await expect(page.getByTestId("alert-types")).toContainText("Heat");
    // The verified alert has its own, different shape: filled where this one is outlined.
    const shape = (selector: string) => page.locator(selector).evaluate((element) => getComputedStyle(element).backgroundColor);
    const unverified = await shape(".alert-verify--unverified");
    await openResident(page, `/en/alerts/${T1}`, 390);
    expect(await shape(".alert-verify--verified")).not.toBe(unverified);
  });

  test("says an alert's time has passed when it has and nothing closed it yet, and shows no valid line", async ({ page }) => {
    await openResident(page, `/en/alerts/${T3}`, 390);

    await expect(page.getByTestId("alert-ended")).toHaveText("This alert reached its end time without a final update.");
    await expect(page.getByTestId("alert-valid")).toHaveCount(0);
  });

  test("says in Urdu that part of it is machine translated, shows the label, and 'Read it in English' shows the English, left to right", async ({ page }) => {
    await openResident(page, `/ur/alerts/${T1}`, 390);

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const text = page.getByTestId("alert-text");
    await expect(text).toHaveAttribute("lang", "ur");
    await expect(text).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("alert-mt")).toContainText(catalogText("ur", "x04.label"));
    const toggle = page.getByTestId("alert-english-toggle");
    await expect(toggle).toHaveText(catalogText("ur", "x04.showSource").replace("{lang}", "English"));
    // Closed until the resident opens it.
    await expect(page.getByTestId("alert-english-body")).toBeHidden();
    await toggle.click();
    const english = page.getByTestId("alert-english-body");
    await expect(english).toBeVisible();
    await expect(english).toHaveText(UPDATE);
    await expect(english).toHaveAttribute("lang", "en");
    await expect(english).toHaveAttribute("dir", "ltr");
    await toggle.click();
    await expect(english).toBeHidden();
  });

  for (const lang of ["ps", "tl"] as const) {
    test(`${lang}: a language the alert was not translated into shows the English with the note that says so, in ${lang}`, async ({ page }) => {
      await openResident(page, `/${lang}/alerts/${T1}`, 390);

      const text = page.getByTestId("alert-text");
      await expect(text).toHaveText(UPDATE);
      await expect(text).toHaveAttribute("lang", "en");
      await expect(text).toHaveAttribute("dir", "ltr");
      await expect(text).toHaveAttribute("data-translation", "unavailable");
      // The note is the catalog's, in the resident's language (or its English behind the [EN] marker where that language has none yet).
      const note = page.getByTestId("alert-unavailable");
      await expect(note).toBeVisible();
      await expect(note).toHaveAttribute("role", "note");
      const title = catalogText(lang, "x04.unavailable");
      await expect(note).toContainText(isFallback(title) ? title.slice("[EN] ".length) : title);
      // It was not machine translated, so no label and no second English.
      await expect(page.getByTestId("alert-mt")).toHaveCount(0);
      await expect(page.getByTestId("alert-english")).toHaveCount(0);
    });
  }

  test("is a 404 inside the shell for an address nobody has an alert at, and shows nothing of any alert", async ({ page }) => {
    for (const path of [`/en/alerts/nosuchslug`, `/en/alerts/${T1.toUpperCase()}`, `/en/alerts/x`, `/en/alerts`, `/en/alerts/${T1}/nothing`, `/ur/alerts/nosuchslug`]) {
      const response = await openResident(page, path, 390);

      expect(response!.status(), path).toBe(404);
      await expect(page.getByTestId("shell-nav"), path).toBeVisible();
      await expect(page.locator("main h1"), path).toHaveText(catalogText(path.split("/")[1], "shell.pageNotFound").replace(/^\[EN\] /, ""));
      await expect(page.getByTestId("alert-detail"), path).toHaveCount(0);
    }
    expect((await openResident(page, `/en/alerts/nosuchslug/verified`, 390))!.status()).toBe(404);
  });

  test("marks Now as the current page in the navigation", async ({ page }) => {
    await openResident(page, `/en/alerts/${T1}`, 390);

    await expect(page.getByTestId("shell-nav-now")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("shell-nav-ready")).not.toHaveAttribute("aria-current", "page");
  });

  test("sets no cookie, in any language, for an alert, for what verified means, or for a 404", async ({ request }) => {
    const checked: string[] = [];
    for (const { code } of LAUNCH_LANGUAGES) {
      for (const path of [`/${code}/alerts/${T1}`, `/${code}/alerts/${T1}/verified`, `/${code}/alerts/nosuchslug`]) {
        const response = await request.get(path, { maxRedirects: 0 });

        expect(noCookie(response), path).toEqual([]);
        checked.push(path);
      }
      const feed = await request.get(`/api/feed?lang=${code}`, { maxRedirects: 0 });
      expect(noCookie(feed), code).toEqual([]);
    }
    expect(checked).toHaveLength(LAUNCH_LANGUAGES.length * 3);
  });

  test("asks the server for nothing about the resident: the alert page is the same request for everyone", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin === new URL(ALERTS_URL).origin) requests.push(`${request.method()} ${url.pathname}${url.search}`);
    });
    await openResident(page, `/en/alerts/${T1}`, 390);

    for (const line of requests) expect(line, line).not.toMatch(/building|floor|group|4154146/i);
    expect(requests.some((line) => line.startsWith("POST"))).toBe(false);
  });

  for (const [lang, slug, name] of [
    ["en", T1, "elevator"],
    ["ur", T1, "elevator"],
    ["en", T2, "unverified"],
    ["en", T3, "ended"],
    ["ps", T1, "fallback"],
  ] as const) {
    for (const width of lang === "en" || lang === "ur" ? ([390, 1280] as const) : ([390] as const)) {
      test(`${lang} ${name} alert at ${width}px has no horizontal scrolling, every link is a tap target and it matches its baseline screenshot`, async ({ page }) => {
        await openResident(page, `/${lang}/alerts/${slug}`, width, 900);
        if (lang === "ur") await page.getByTestId("alert-english-toggle").click();
        await showWholePage(page, width);

        expect(await overflow(page)).toEqual({ page: 0, main: 0 });
        expect(await tapViolations(page)).toEqual([]);
        await expectBaseline(page, `alert-${lang}-${name}-${width}.png`);
      });
    }
  }

  for (const width of [320, 768] as const) {
    test(`the alert has no horizontal scrolling at ${width}px in English and in a right-to-left language`, async ({ page }) => {
      for (const lang of ["en", "ur"]) {
        await openResident(page, `/${lang}/alerts/${T1}`, width);

        expect(await overflow(page), lang).toEqual({ page: 0, main: 0 });
      }
    });
  }
});

test.describe("a corrected and a withdrawn entry (S05.02)", () => {
  test("names the entry a correction or a withdrawal replaces in the feed, with no field a phone in the field would refuse", async ({ request }) => {
    const feed = FeedV1.parse(await (await request.get("/api/feed?lang=en")).json());
    const thread = feed.threads.find((candidate) => candidate.slug === T4)!;
    const byKind = Object.fromEntries(thread.entries.map((entry) => [entry.kind, entry]));
    expect(thread.entries.map((entry) => entry.kind)).toEqual(["ack", "update", "correction", "withdrawal"]);
    expect(byKind.correction.supersedes_id).toBe(thread.entries[0].id);
    expect(byKind.withdrawal.supersedes_id).toBe(thread.entries[1].id);
    expect(byKind.ack.supersedes_id).toBeUndefined();
    expect(byKind.withdrawal.text.body).toBe(WITHDRAWAL_REASON);
    // A withdrawal has no phase of its own (the thread keeps the one it had), and no reason code: its text is the reason.
    expect(Object.keys(byKind.withdrawal).sort()).toEqual(["attribution", "id", "kind", "original", "published_at", "supersedes_id", "text", "verified"]);
  });

  test('shows the correction above the entry it replaces, which stays readable marked "Corrected", and a withdrawn entry marked "Withdrawn" with the reason in its place', async ({ page }) => {
    await openResident(page, `/en/alerts/${T4}`, 390);

    // What is true now is the correction's; the home card says the same.
    await expect(page.getByTestId("alert-text")).toHaveText(CORRECTION);
    const entries = page.getByTestId("alert-thread").locator("li");
    await expect(entries).toHaveCount(3);
    await expect(entries.nth(0)).toContainText("Correction");
    await expect(entries.nth(0)).toContainText("Latest");
    await expect(entries.nth(0)).toContainText(CORRECTION);
    await expect(entries.nth(0)).not.toHaveAttribute("data-mark", /.+/);
    // The withdrawn update: the word and the reason in its place, not the wording it had.
    await expect(entries.nth(1)).toHaveAttribute("data-mark", "withdrawn");
    await expect(entries.nth(1)).toContainText("Withdrawn");
    await expect(entries.nth(1)).toContainText(WITHDRAWAL_REASON);
    await expect(entries.nth(1)).not.toContainText("Toronto Hydro says");
    // The corrected acknowledgement: still readable, marked, with the time of the correction.
    await expect(entries.nth(2)).toHaveAttribute("data-mark", "corrected");
    await expect(entries.nth(2)).toContainText("Corrected 3 hours ago");
    await expect(entries.nth(2)).toContainText(WITHDRAWN_ACK);
    // The notice itself is not an entry of its own.
    await expect(page.getByTestId("alert-thread")).not.toContainText("Withdrawal");
  });

  test("shows the home card with the correction's words, and the share preview says the same as the alert", async ({ page, request }) => {
    await openResident(page, "/en", 390);
    await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "ready");
    await expect(page.getByTestId(`alert-card-text-${T4}`)).toHaveText(CORRECTION);

    const html = await (await request.get(`/en/alerts/${T4}`)).text();
    const description = metaOf(html, "description")?.replace(/[\u202f\u00a0]/g, " ");
    const og = metaOf(html, "og:description")?.replace(/[\u202f\u00a0]/g, " ");
    // S05.08: the facts first (verification, place, time), then the correction's words.
    expect(description).toBe(`Verified by the Hub \u00b7 4 Milepost Pl \u00b7 Updated today at 8:00 AM \u2014 Correction: ${CORRECTION}`);
    expect(og).toBe(description);
    expect(description).not.toContain("floors 1 to 6 at");
  });

  for (const width of [390, 1280] as const) {
    test(`the alert at ${width}px has no horizontal scrolling, every link is a tap target and it matches its baseline screenshot`, async ({ page }) => {
      await openResident(page, `/en/alerts/${T4}`, width, 900);
      await showWholePage(page, width);

      expect(await overflow(page)).toEqual({ page: 0, main: 0 });
      expect(await tapViolations(page)).toEqual([]);
      await expectBaseline(page, `alert-en-corrected-${width}.png`);
    });
  }
});

test.describe("a thread that closed (S05.03)", () => {
  test("is not in the live feed, which lists open threads only, and has no card on home", async ({ page, request }) => {
    const feed = FeedV1.parse(await (await request.get("/api/feed?lang=en")).json());
    expect(feed.threads.map((thread) => thread.slug)).toEqual([T1, T2, T3, T4]);
    await openResident(page, "/en", 390);
    await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "ready");
    for (const slug of [RESOLVED, EXPIRED, WITHDRAWN]) await expect(page.getByTestId(`alert-card-${slug}`)).toHaveCount(0);
  });

  test("opens from its address with how it closed: resolved, with the check icon, the time, the final message as what stands and every earlier entry", async ({ page }) => {
    const response = await openResident(page, `/en/alerts/${RESOLVED}`, 390);

    expect(response!.status()).toBe(200);
    const closed = page.getByTestId("alert-closed");
    await expect(closed).toHaveAttribute("data-reason", "resolved");
    await expect(closed.locator(".alert-ico--check")).toBeVisible();
    await expect(page.getByTestId("alert-closed-title")).toHaveText("Resolved 2 hours ago");
    await expect(page.getByTestId("alert-closed-line")).toHaveText("This alert has ended. It was resolved 2 hours ago.");
    await expect(page.getByTestId("alert-text")).toHaveText(FINAL);
    const entries = page.getByTestId("alert-thread").locator("li");
    await expect(entries).toHaveCount(3);
    await expect(entries.nth(0)).toContainText("Final update");
    await expect(entries.nth(1)).toContainText("Update");
    await expect(entries.nth(2)).toContainText("First message");
    await expect(entries.nth(2)).toContainText("Power is out on floors 1 to 6 at 40 Gateway Blvd.");
    // It is over: no valid-until, and no "reached its end time" note beside the one that says how it ended.
    await expect(page.getByTestId("alert-valid")).toHaveCount(0);
    await expect(page.getByTestId("alert-ended")).toHaveCount(0);
  });

  test("says expired in words and with the clock icon, and withdrawn with the reason and the information icon: each its own", async ({ page }) => {
    await openResident(page, `/en/alerts/${EXPIRED}`, 390);
    await expect(page.getByTestId("alert-closed")).toHaveAttribute("data-reason", "expired");
    await expect(page.getByTestId("alert-closed").locator(".alert-ico--clock")).toBeVisible();
    await expect(page.getByTestId("alert-closed-title")).toHaveText("Expired 7 hours ago");
    await expect(page.getByTestId("alert-closed-line")).toHaveText("This alert has ended. It expired 7 hours ago without a final update.");

    await openResident(page, `/en/alerts/${WITHDRAWN}`, 390);
    await expect(page.getByTestId("alert-closed")).toHaveAttribute("data-reason", "withdrawn");
    await expect(page.getByTestId("alert-closed").locator(".alert-ico--info")).toBeVisible();
    await expect(page.getByTestId("alert-closed-title")).toHaveText("Withdrawn");
    await expect(page.getByTestId("alert-closed-line")).toHaveText(`The Hub withdrew this alert. ${WITHDRAWAL_REASON}`);
  });

  test("describes the page with the final message, and sets no cookie, in any language", async ({ request }) => {
    const html = await (await request.get(`/en/alerts/${RESOLVED}`)).text();
    expect(metaOf(html, "description")).toBe(`Verified by the Hub \u00b7 4 Milepost Pl \u2014 ${FINAL}`);
    expect(metaOf(html, "og:title")?.replace(/[\u202f\u00a0]/g, " ")).toBe("Power: Resolved today at 9:00 AM");
    for (const { code } of LAUNCH_LANGUAGES) expect(noCookie(await request.get(`/${code}/alerts/${RESOLVED}`, { maxRedirects: 0 })), code).toEqual([]);
  });

  for (const [lang, slug, name] of [
    ["en", RESOLVED, "closed-resolved"],
    ["ur", RESOLVED, "closed-resolved"],
    ["en", EXPIRED, "closed-expired"],
    ["en", WITHDRAWN, "closed-withdrawn"],
  ] as const) {
    for (const width of lang === "en" || lang === "ur" ? ([390, 1280] as const) : ([390] as const)) {
      test(`${lang} ${name} alert at ${width}px has no horizontal scrolling, every link is a tap target and it matches its baseline screenshot`, async ({ page }) => {
        await openResident(page, `/${lang}/alerts/${slug}`, width, 900);
        await showWholePage(page, width);

        expect(await overflow(page)).toEqual({ page: 0, main: 0 });
        expect(await tapViolations(page)).toEqual([]);
        await expectBaseline(page, `alert-${lang}-${name}-${width}.png`);
      });
    }
  }
});

test.describe("what verified means (R-28)", () => {
  test("says who verified this alert and when, what the words mean and the words one will see, in the page language", async ({ page }) => {
    await openResident(page, `/en/alerts/${T1}/verified`, 390);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText('What "verified" means');
    await expect(page.getByTestId("verified-line")).toHaveText("The Hub verified this alert 20 minutes ago.");
    await expect(page.getByTestId("legend-verified")).toHaveAttribute("data-current", "true");
    await expect(page.getByTestId("legend-unverified")).toHaveAttribute("data-current", "false");
    await expect(page.getByTestId("verified-body")).toContainText("Verified means someone at the Hub");
    await expect(page.locator('[data-component="not-911"]')).toHaveCount(1);
  });

  test("says an alert that is not yet verified is not wrong, and can be acted on", async ({ page }) => {
    await openResident(page, `/en/alerts/${T2}/verified`, 390);

    await expect(page.getByTestId("legend-unverified")).toHaveAttribute("data-current", "true");
    await expect(page.getByTestId("verified-this")).toContainText("Not yet verified does not mean it is wrong.");
    await expect(page.getByTestId("verified-line")).toHaveCount(0);
  });

  for (const [lang, slug, name] of [
    ["en", T1, "verified"],
    ["ur", T1, "verified"],
    ["en", T2, "unverified"],
  ] as const) {
    test(`${lang} ${name} page at 390px has no horizontal scrolling and matches its baseline screenshot`, async ({ page }) => {
      await openResident(page, `/${lang}/alerts/${slug}/verified`, 390, 900);
      await showWholePage(page, 390);

      expect(await overflow(page)).toEqual({ page: 0, main: 0 });
      expect(await tapViolations(page)).toEqual([]);
      await expectBaseline(page, `alert-verified-${lang}-${name}-390.png`);
    });
  }
});

// S05.08: share an alert in one step (R-29) and the link that is shared, /a/{slug}?l={lang} (the share landing, A11), against the same fixture. The server is the
// alerts server: the same production build, its own port, the feed read from fixtures/feed.json; the clock of that file is fixed, so every time reads the same.
const SHARE_PATH = (slug: string, lang = "en") => `/${lang}/alerts/${slug}/share`;
const decode = (text: string) => text.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** The content of one <meta> of a page (`name="description"` or `property="og:title"`), undone from its HTML escaping, or undefined. */
const metaOf = (html: string, key: string) => {
  const found = new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`).exec(html);
  return found ? decode(found[1]) : undefined;
};
/** Every request the page makes to the app's own server from now on: the proof that an action sends nothing. */
function watchRequests(page: Page) {
  const seen: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === new URL(ALERTS_URL).origin) seen.push(`${request.method()} ${url.pathname}${url.search}`);
  });
  return seen;
}
/** The message as the page previews it, a line each. */
const previewedLines = (page: Page) => page.getByTestId("share-message").locator("p").allInnerTexts();

test.describe("share an alert (R-29, S05.08)", () => {
  test("R-07 offers Share, which opens R-29 for the same alert, and R-29's back goes to the alert", async ({ page }) => {
    await openResident(page, `/en/alerts/${T1}`, 390);

    await expect(page.getByTestId("alert-share")).toHaveText("Share");
    await expect(page.getByTestId("alert-share")).toHaveAttribute("href", SHARE_PATH(T1));
    await page.getByTestId("alert-share").click();
    await expect(page).toHaveURL(new RegExp(`${SHARE_PATH(T1)}$`));
    await expect(page.getByTestId("share-title")).toHaveText("Share this alert");
    await page.getByTestId("share-back").click();
    await expect(page).toHaveURL(new RegExp(`/en/alerts/${T1}$`));
  });

  test("previews the standard message in the fixed order: what, who and whether the Hub checked it, where, when, the 911 line and the link", async ({ page }) => {
    await openResident(page, SHARE_PATH(T1), 390);

    const lines = (await previewedLines(page)).map((line) => line.replace(/[  ]/g, " "));
    expect(lines).toEqual([
      `Elevator: ${UPDATE}`,
      "Community alert from the Hub",
      "Verified by the Hub",
      "4 Milepost Pl",
      "Posted today at 10:00 AM",
      "Updated today at 10:40 AM",
      "Not an emergency service. In danger? Call 911.",
      `Newest updates and any corrections: ${PUBLIC_ORIGIN}/a/${T1}?l=en`,
    ]);
    await expect(page.getByTestId("share-everyone")).toHaveText("Everyone gets this version. Nothing tailored to you is shared.");
    await expect(page.getByTestId("share-not-recorded")).toHaveText("The CVH does not record who shares alerts or who you send them to.");
  });

  test("shares an alert that is not yet verified as 'Not yet verified', in English and with its own link", async ({ page }) => {
    await openResident(page, SHARE_PATH(T2), 390);

    const lines = await previewedLines(page);
    expect(lines).toContain("Not yet verified");
    expect(lines.join("\n")).not.toContain("Verified by");
    expect(lines.at(-1)).toBe(`Newest updates and any corrections: ${PUBLIC_ORIGIN}/a/${T2}?l=en`);
  });

  test("is in the page's language, with a link that opens in it", async ({ page }) => {
    await openResident(page, SHARE_PATH(T1, "ur"), 390);

    const lines = await previewedLines(page);
    expect(lines[0]).toContain("لفٹ");
    expect(lines.at(-1)).toContain(`${PUBLIC_ORIGIN}/a/${T1}?l=ur`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });

  test("says that a corrected alert is its correction, and a thread that closed how it closed, with the time as a clock time", async ({ page }) => {
    await openResident(page, SHARE_PATH(T4), 390);
    const corrected = (await previewedLines(page)).join("\n");
    expect(corrected).toContain(`Power: Correction: ${CORRECTION}`);
    expect(corrected).not.toContain("floors 1 to 6 at");
    expect(corrected).not.toMatch(/\bago\b/);

    await openResident(page, SHARE_PATH(RESOLVED), 390);
    const closed = (await previewedLines(page)).join("\n").replace(/[  ]/g, " ");
    expect(closed).toContain(`Power: ${FINAL}`);
    expect(closed).toMatch(/This alert has ended\. It was resolved today at \d{1,2}:\d{2} [AP]M\./);
  });

  test("is the same standard message whoever shares it: a phone with chosen buildings and groups previews and shares exactly what any other does", async ({ browser }) => {
    const message = async (choices: object) => {
      const context = await browser.newContext({ baseURL: ALERTS_URL, storageState: { cookies: [], origins: [{ origin: ALERTS_URL, localStorage: [{ name: "cvh.choices", value: JSON.stringify(choices) }] }] } });
      try {
        const page = await context.newPage();
        await page.addInitScript(() => {
          (window as unknown as { __shared: unknown[] }).__shared = [];
          navigator.share = async (data) => void (window as unknown as { __shared: unknown[] }).__shared.push(data);
        });
        await openResident(page, SHARE_PATH(T1), 390);
        await page.getByTestId("share-send").click();
        const shared = await page.evaluate(() => (window as unknown as { __shared: { text: string }[] }).__shared);
        return { previewed: await previewedLines(page), shared };
      } finally {
        await context.close();
      }
    };

    const plainPhone = await message({ v: 1, welcomed: true });
    const tailoredPhone = await message({ v: 1, welcomed: true, lang: "en", groups: ["seniors", "families"], buildings: ["4154146"], floors: [] });

    expect(tailoredPhone).toEqual(plainPhone);
    expect(plainPhone.shared).toHaveLength(1);
    expect(plainPhone.shared[0].text).toBe(plainPhone.previewed.join("\n"));
  });

  test("Share opens the phone's share sheet with the previewed text and nothing else, and asks the server for nothing", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __shared: unknown[] }).__shared = [];
      navigator.share = async (data) => void (window as unknown as { __shared: unknown[] }).__shared.push(data);
    });
    await openResident(page, SHARE_PATH(T1), 390);
    await expect(page.getByTestId("share-actions")).toHaveAttribute("data-sheet", "available");
    const requests = watchRequests(page);

    await page.getByTestId("share-send").click();
    await page.waitForTimeout(500);

    const shared = await page.evaluate(() => (window as unknown as { __shared: { text: string }[] }).__shared);
    expect(shared).toEqual([{ text: (await previewedLines(page)).join("\n") }]);
    expect(shared[0].text).toContain(`${PUBLIC_ORIGIN}/a/${T1}?l=en`);
    // Nothing about the sharing was sent: no request of any kind, no usage event.
    expect(requests).toEqual([]);
    await expect(page.getByTestId("share-copy")).toHaveCount(0);
  });

  test("a resident who closes the share sheet without choosing is not told anything and keeps the same button", async ({ page }) => {
    await page.addInitScript(() => {
      navigator.share = async () => {
        throw new DOMException("closed", "AbortError");
      };
    });
    await openResident(page, SHARE_PATH(T1), 390);

    await page.getByTestId("share-send").click();

    await expect(page.getByTestId("share-send")).toBeVisible();
    await expect(page.getByTestId("share-copy")).toHaveCount(0);
    await expect(page.getByTestId("share-status")).toHaveText("");
  });

  test("where the phone has no share sheet, or cannot open it, Copy and WhatsApp are offered: Copy puts the message on the clipboard, WhatsApp is the wa.me link with the message", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
      (window as unknown as { __copied: string[] }).__copied = [];
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => void (window as unknown as { __copied: string[] }).__copied.push(text) }, configurable: true });
    });
    await openResident(page, SHARE_PATH(T1), 390);

    await expect(page.getByTestId("share-actions")).toHaveAttribute("data-sheet", "unavailable");
    await expect(page.getByTestId("share-send")).toHaveCount(0);
    await expect(page.getByTestId("share-no-sheet")).toHaveText("Your phone does not offer share options here. Copy the message, or send it on WhatsApp.");
    const text = (await previewedLines(page)).join("\n");
    const whatsapp = page.getByTestId("share-whatsapp");
    await expect(whatsapp).toHaveText("Send on WhatsApp");
    await expect(whatsapp).toHaveAttribute("href", `https://wa.me/?text=${encodeURIComponent(text)}`);
    await expect(whatsapp).toHaveAttribute("rel", "noopener noreferrer");
    const requests = watchRequests(page);

    await page.getByTestId("share-copy").click();

    await expect(page.getByTestId("share-status")).toHaveText("Copied. You can paste it into any app.");
    expect(await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual([text]);
    expect(requests).toEqual([]);
  });

  test("a share sheet that fails to open falls back to Copy and WhatsApp, and a phone that will not copy says so", async ({ page }) => {
    await page.addInitScript(() => {
      navigator.share = async () => {
        throw new DOMException("not allowed here", "NotAllowedError");
      };
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async () => {
            throw new Error("blocked");
          },
        },
        configurable: true,
      });
    });
    await openResident(page, SHARE_PATH(T1), 390);

    await page.getByTestId("share-send").click();

    await expect(page.getByTestId("share-copy")).toBeVisible();
    await expect(page.getByTestId("share-whatsapp")).toBeVisible();
    await page.getByTestId("share-copy").click();
    await expect(page.getByTestId("share-status")).toHaveText("Your phone would not copy it. Press and hold the message above to copy it.");
  });

  test("is a 404 inside the shell with nothing of any alert for an address nobody has an alert at", async ({ request }) => {
    const response = await request.get(SHARE_PATH("nosuchslug"), { maxRedirects: 0 });

    expect(response.status()).toBe(404);
    expect(noCookie(response)).toEqual([]);
    expect(await response.text()).not.toContain(ACK_EN);
  });

  for (const [lang, slug, name] of [
    ["en", T1, "verified"],
    ["en", T2, "unverified"],
    ["ur", T1, "verified"],
  ] as const) {
    for (const width of lang === "en" ? ([390, 1280] as const) : ([390] as const)) {
      test(`${lang} ${name} share screen at ${width}px has no horizontal scrolling, every control is a tap target and it matches its baseline screenshot`, async ({ page }) => {
        await page.addInitScript(() => {
          navigator.share = async () => undefined;
        });
        await openResident(page, SHARE_PATH(slug, lang), width, 900);
        await showWholePage(page, width);

        expect(await overflow(page)).toEqual({ page: 0, main: 0 });
        expect(await tapViolations(page)).toEqual([]);
        await expectBaseline(page, `share-${lang}-${name}-${width}.png`);
      });
    }
  }

  test("the fallback (no share sheet) at 390px has no horizontal scrolling, tap targets and matches its baseline screenshot", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, "share", { value: undefined, configurable: true }));
    await openResident(page, SHARE_PATH(T1), 390, 900);
    await expect(page.getByTestId("share-copy")).toBeVisible();
    await showWholePage(page, 390);

    expect(await overflow(page)).toEqual({ page: 0, main: 0 });
    expect(await tapViolations(page)).toEqual([]);
    await expectBaseline(page, "share-en-fallback-390.png");
  });
});

test.describe("the shared link /a/{slug}?l={lang} (A11, S05.08)", () => {
  const landing = (slug: string, lang?: string) => `/a/${slug}${lang === undefined ? "" : `?l=${lang}`}`;

  test("shows the alert in its current state in the language of `l` at the address that was shared, with Open Graph metadata in that language", async ({ page, request }) => {
    await page.goto(landing(T1, "en"));

    await expect(page).toHaveURL(new RegExp(`${landing(T1, "en").replace("?", "\\?")}$`));
    await expect(page.getByTestId("alert-detail")).toBeVisible();
    await expect(page.getByTestId("alert-text")).toHaveText(UPDATE);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    const html = await (await request.get(landing(T1, "en"))).text();
    const description = metaOf(html, "og:description")?.replace(/[  ]/g, " ");
    expect(metaOf(html, "og:title")).toBe("Elevator");
    expect(description).toBe(`Verified by the Hub · 4 Milepost Pl · Updated today at 10:40 AM — ${UPDATE}`);
    expect(metaOf(html, "description")?.replace(/[  ]/g, " ")).toBe(description);
    expect(html).toContain("<title>Elevator</title>");
  });

  test("is in Urdu for l=ur, left to right text kept as it is, and its metadata is in Urdu", async ({ page, request }) => {
    await page.goto(landing(T1, "ur"));

    await expect(page.locator("html")).toHaveAttribute("lang", "ur");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const html = await (await request.get(landing(T1, "ur"))).text();
    expect(metaOf(html, "og:title")).toBe(catalogText("ur", "x13.elevator"));
    expect(metaOf(html, "og:description")).toContain(catalogText("ur", "x02.verifiedBy").replace("{org}", catalogText("ur", "x02.hub")));
  });

  test("is English when `l` is missing or is not one of our languages, and never redirects", async ({ request }) => {
    for (const path of [landing(T1), landing(T1, ""), landing(T1, "xx"), landing(T1, "../staff")]) {
      const response = await request.get(path, { maxRedirects: 0 });

      expect(response.status(), path).toBe(200);
      expect(await response.text(), path).toContain('<html lang="en"');
    }
  });

  test("shows the corrected alert with its correction above the original, and a thread that closed with how it closed", async ({ page, request }) => {
    await page.goto(landing(T4, "en"));
    await expect(page.getByTestId("alert-text")).toHaveText(CORRECTION);
    await expect(page.locator('[data-mark="corrected"]')).toHaveCount(1);
    const corrected = await (await request.get(landing(T4, "en"))).text();
    expect(metaOf(corrected, "og:description")).toContain(`Correction: ${CORRECTION}`);

    await page.goto(landing(RESOLVED, "en"));
    await expect(page.getByTestId("alert-closed")).toHaveAttribute("data-reason", "resolved");
    const resolved = await (await request.get(landing(RESOLVED, "en"))).text();
    expect(metaOf(resolved, "og:title")).toMatch(/^Power: Resolved today at \d{1,2}:\d{2}/);
    expect(metaOf(resolved, "og:description")).toContain(FINAL);

    const withdrawn = await (await request.get(landing(WITHDRAWN, "en"))).text();
    expect(metaOf(withdrawn, "og:title")).toBe("Power: Withdrawn");
    expect(metaOf(withdrawn, "og:description")).toContain(WITHDRAWAL_REASON);
    expect(metaOf(withdrawn, "og:description")).not.toContain(WITHDRAWN_ACK);
  });

  test("is a 404 with no detail for an unknown address, in every language, and for an address that is not a slug", async ({ request }) => {
    for (const { code } of LAUNCH_LANGUAGES) {
      for (const path of [landing("nosuchslug", code), landing("short", code), landing("UPPERCASE1", code)]) {
        const response = await request.get(path, { maxRedirects: 0 });

        expect(response.status(), path).toBe(404);
        expect(noCookie(response), path).toEqual([]);
        const body = await response.text();
        expect(body, path).not.toContain(ACK_EN);
        expect(body, path).not.toContain('property="og:description"');
      }
    }
    for (const path of ["/a", `/a/${T1}/more`]) expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
  });

  test("sets no cookie, in any language, for the alert, a thread that closed, an unknown address or the share screen", async ({ request }) => {
    for (const { code } of LAUNCH_LANGUAGES) {
      for (const path of [landing(T1, code), landing(RESOLVED, code), landing("nosuchslug", code), SHARE_PATH(T1, code)]) {
        expect(noCookie(await request.get(path, { maxRedirects: 0 })), path).toEqual([]);
      }
    }
    expect(noCookie(await request.get(landing(T1), { maxRedirects: 0 }))).toEqual([]);
  });

  test("asks the server for nothing but the page: the recipient's one request is the shared address, and the browser keeps no cookie", async ({ page, context }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin === new URL(ALERTS_URL).origin && request.resourceType() === "document") requests.push(`${request.method()} ${url.pathname}${url.search}`);
    });
    await page.goto(landing(T1, "en"));
    await page.waitForLoadState("networkidle");

    expect(requests).toEqual([`GET ${landing(T1, "en")}`]);
    expect(await context.cookies()).toEqual([]);
  });

  test.describe("a phone that has a saved language", () => {
    test.use({ storageState: { cookies: [], origins: [{ origin: ALERTS_URL, localStorage: [{ name: "cvh.choices", value: JSON.stringify({ v: 1, welcomed: true, lang: "ur" }) }] }] } });

    test("moves from the language of the link to its own once the page has loaded, to the same alert", async ({ page }) => {
      await page.goto(landing(T1, "en"));

      await expect(page).toHaveURL(new RegExp(`/ur/alerts/${T1}$`));
      await expect(page.locator("html")).toHaveAttribute("lang", "ur");
      await expect(page.getByTestId("alert-detail")).toBeVisible();
    });

    test("stays where it is when the link is already in its language", async ({ page }) => {
      await page.goto(landing(T1, "ur"));
      await expect(page.getByTestId("alert-detail")).toBeVisible();
      await page.waitForTimeout(800);

      await expect(page).toHaveURL(new RegExp(`${landing(T1, "ur").replace("?", "\\?")}$`));
    });
  });

  test("a phone with no saved language stays in the language of the link", async ({ page }) => {
    await page.goto(landing(T1, "ur"));
    await expect(page.getByTestId("alert-detail")).toBeVisible();
    await page.waitForTimeout(800);

    await expect(page).toHaveURL(new RegExp(`${landing(T1, "ur").replace("?", "\\?")}$`));
    await expect(page.locator("html")).toHaveAttribute("lang", "ur");
  });
});
