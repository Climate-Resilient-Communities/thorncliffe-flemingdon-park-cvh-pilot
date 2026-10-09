import axe from "axe-core";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { targetSpacingViolations, tapViolations } from "../helpers/tap-check";
import { ALERTS_URL } from "./alerts-server";
import { BUILDINGS, stubBuildingList } from "./choices-fixture";
import { newServer, stubDirectory } from "./directory-fixture";
import { openResident, waitForFonts } from "./helpers";
import { feedOf, stubArchive, stubFeed } from "./home-fixture";

// S02.14 (NFR-N2, UX-DR18, UX-DR19): every resident page of E02 to E05, in normal and in basic mode, in English, Urdu and Tamil:
// no serious or critical WCAG 2.1 AA violation (axe-core, injected as search.spec.ts does), the structure a screen reader
// moves by (one banner, one main, one navigation, one h1, headings and labels), a focus order that follows the page, and
// touch targets of the right size at 320 px. Basic mode is the saved choice, so every page below is opened the way a
// resident who turned it on opens it: with `basic` in cvh.choices and <html data-basic> set by the page before its first paint.

// One test for each language and mode (and each page for the focus order), so the tests of this file run in parallel, on as many workers as the
// run has: the file was the longest of the suite, on one worker. Each test makes its own contexts and stubs its own routes; the three servers of
// the config are only read (fixed origins, no state a test writes), so tests of any workers may share them.
test.describe.configure({ mode: "parallel" });

const LANGS = ["en", "ur", "ta"] as const;
type Lang = (typeof LANGS)[number];
const SIGNED_BUILDING = BUILDINGS[0].rsn;
// The building page (S02.08) is drawn by the server from the sample buildings of fixtures/buildings.json (CVH_FAKE_BUILDINGS_FILE),
// not from choices-fixture's list, whose numbers it does not have: this is its first, 4 Milepost Pl.
const PAGE_BUILDING = "4154146";
const ALERT = "qrstvwxz";

type PageCase = {
  name: string;
  path: (lang: Lang) => string;
  /** The server of the alert fixtures (S04.08); everything else is on the main server. */
  alerts?: boolean;
  /** The first-run steps are opened by a resident who has not been through them. */
  firstRun?: boolean;
  stub?: (page: Page) => Promise<void>;
  settle?: (page: Page, basic: boolean) => Promise<void>;
};

const directory = async (page: Page) => {
  await stubDirectory(page, newServer(11));
  await stubBuildingList(page);
};

const PAGES: PageCase[] = [
  {
    name: "home",
    path: (l) => `/${l}`,
    stub: async (page) => void (await stubFeed(page, [feedOf(1)])),
    settle: (page) => expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "ready"),
  },
  { name: "ask", path: (l) => `/${l}/search`, stub: directory },
  { name: "directory", path: (l) => `/${l}/directory`, stub: directory },
  { name: "listing", path: (l) => `/${l}/directory/P101`, stub: directory },
  {
    name: "map",
    path: (l) => `/${l}/map`,
    stub: async (page) => {
      await directory(page);
      await page.route(/basemaps\.cartocdn\.com/, (route) => route.abort("internetdisconnected"));
    },
    settle: (page, basic) => (basic ? expect(page.getByTestId("map-list")).toBeVisible() : expect(page.getByTestId("map-canvas")).toHaveAttribute("data-status", "ready")),
  },
  { name: "be ready", path: (l) => `/${l}/ready` },
  { name: "guide", path: (l) => `/${l}/ready/heat` },
  { name: "numbers", path: (l) => `/${l}/ready/numbers`, stub: stubBuildingList },
  // S08.05: Ask for a check-in (R-33).
  { name: "ask for a check-in", path: (l) => `/${l}/ready/check-in` },
  { name: "building", path: (l) => `/${l}/buildings/${PAGE_BUILDING}` },
  { name: "my choices", path: (l) => `/${l}/choices`, stub: stubBuildingList },
  { name: "choose language", path: (l) => `/${l}/choices/language` },
  { name: "choose place", path: (l) => `/${l}/choices/place`, stub: stubBuildingList },
  { name: "choose groups", path: (l) => `/${l}/choices/groups` },
  { name: "welcome", path: (l) => `/${l}/welcome`, firstRun: true },
  { name: "welcome groups", path: (l) => `/${l}/welcome/groups`, firstRun: true },
  { name: "welcome place", path: (l) => `/${l}/welcome/place`, firstRun: true, stub: stubBuildingList },
  { name: "text alerts", path: (l) => `/${l}/text-alerts`, stub: stubBuildingList },
  {
    // S07.06: the one-time web link's page, with its choices (the server here has no database, so the view is answered here).
    name: "change text alerts",
    path: (l) => `/${l}/subscription/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE`,
    stub: async (page) => {
      await stubBuildingList(page);
      const view = { v: 1, status: "ok", subscription: { lang: "en", neighbourhood: "TP", places: [{ rsn: SIGNED_BUILDING, floors: [] }], groups: ["seniors"], muted_topics: [], phone_last2: "23", checkin: null } };
      await page.route("**/api/subscription/view", (route) => route.fulfill({ json: view, headers: { "Cache-Control": "no-store" } }));
    },
    settle: (page) => expect(page.getByTestId("subscription-form")).toBeVisible(),
  },
  { name: "terms", path: (l) => `/${l}/terms` },
  {
    name: "archive",
    path: (l) => `/${l}/archive`,
    stub: async (page) => void (await stubArchive(page, [])),
  },
  { name: "alert", path: (l) => `/${l}/alerts/${ALERT}`, alerts: true },
  { name: "what verified means", path: (l) => `/${l}/alerts/${ALERT}/verified`, alerts: true },
  { name: "share an alert", path: (l) => `/${l}/alerts/${ALERT}/share`, alerts: true },
  {
    name: "home with alerts",
    path: (l) => `/${l}`,
    alerts: true,
    stub: async (page) => void (await stubFeed(page, ["unavailable"])),
  },
];

/** The phone before the first page loads: the saved choices of a returning resident, with basic mode on or off. */
async function seed(page: Page, basic: boolean, firstRun = false) {
  await page.addInitScript(
    ([on, first]) => {
      try {
        if (first) localStorage.removeItem("cvh.choices");
        else localStorage.setItem("cvh.choices", JSON.stringify({ v: 1, welcomed: true, ...(on ? { basic: true } : {}) }));
        if (first && on) localStorage.setItem("cvh.choices", JSON.stringify({ v: 1, basic: true }));
      } catch {
        // No storage: the page is in normal mode.
      }
    },
    [basic, firstRun] as const,
  );
}

async function open(page: Page, entry: PageCase, lang: Lang, basic: boolean, width: number) {
  await seed(page, basic, entry.firstRun);
  await entry.stub?.(page);
  const url = entry.alerts ? `${ALERTS_URL}${entry.path(lang)}` : entry.path(lang);
  const response = await openResident(page, url, width);
  // The page itself, not a 404 drawn in its place: every entry is a page that exists.
  expect(response?.status(), `${entry.name}: ${url}`).toBe(200);
  await page.waitForLoadState("networkidle");
  await entry.settle?.(page, basic);
  await expect(page.locator("main h1").first()).toBeVisible();
  expect(await page.locator("html").getAttribute("data-basic")).toBe(basic ? "true" : null);
  await waitForFonts(page);
}

/** A page of its own in a context of its own (no service worker), so a stub or a seed of one page does not leak into the next. */
async function freshPage(browser: Browser, baseURL: string | undefined, width: number) {
  const context = await browser.newContext({ viewport: { width, height: width === 320 ? 640 : 844 }, baseURL, serviceWorkers: "block" });
  return { page: await context.newPage(), close: () => context.close() };
}

type Found = { id: string; impact: string | null | undefined; nodes: string[] };

/** What axe reports for the page as it is, for the WCAG 2.1 A and AA rules (serious and critical only) or for the named rules. */
async function axeRun(page: Page, options: { tags: string[] } | { rules: string[] }, impacts?: string[]): Promise<Found[]> {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ content: axe.source });
  return page.evaluate(
    async ([opts, keep]) => {
      const runOnly = "tags" in opts ? { type: "tag" as const, values: opts.tags } : { type: "rule" as const, values: opts.rules };
      const result = await (window as unknown as { axe: typeof axe }).axe.run(document, { runOnly });
      return result.violations
        .filter((v) => !keep || keep.includes(v.impact ?? ""))
        .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")) }));
    },
    [options, impacts] as const,
  );
}

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
// The structure a screen reader moves by (best practice, so not in the WCAG pass): one main, no second banner, headings in order.
const STRUCTURE = [
  "landmark-one-main",
  "landmark-no-duplicate-banner",
  "landmark-no-duplicate-main",
  "landmark-no-duplicate-contentinfo",
  "landmark-banner-is-top-level",
  "landmark-main-is-top-level",
  "landmark-unique",
  "page-has-heading-one",
  "heading-order",
  "empty-heading",
  "region",
];

test.describe("axe-core finds no serious or critical WCAG 2.1 AA violation", () => {
  for (const lang of LANGS) {
    for (const basic of [false, true]) {
      test(`${lang}, ${basic ? "basic" : "normal"} mode, every resident page at 390 px`, async ({ browser, baseURL }) => {
        test.setTimeout(240_000);
        const found: Record<string, Found[]> = {};
        for (const entry of PAGES) {
          // Each page gets a fresh context state, so a stub or a seed of one page does not leak into the next.
          const { page: tab, close } = await freshPage(browser, baseURL, 390);
          try {
            await open(tab, entry, lang, basic, 390);
            const violations = await axeRun(tab, { tags: WCAG }, ["serious", "critical"]);
            if (violations.length > 0) found[entry.name] = violations;
          } finally {
            await close();
          }
        }
        expect(found).toEqual({});
      });
    }
  }
});

test.describe("structure", () => {
  for (const lang of LANGS) {
    for (const basic of [false, true]) {
      test(`${lang}, ${basic ? "basic" : "normal"} mode: one banner, one main, one navigation, one h1, headings in order and every control named`, async ({ browser, baseURL }) => {
        test.setTimeout(240_000);
        const found: Record<string, unknown> = {};
        for (const entry of PAGES) {
          const { page: tab, close } = await freshPage(browser, baseURL, 390);
          try {
            await open(tab, entry, lang, basic, 390);
            const rules = await axeRun(tab, { rules: STRUCTURE });
            const counts = await tab.evaluate(() => ({
              // A header inside an article, section, main, aside or nav is not the page's banner.
              banner: [...document.querySelectorAll("header, [role=banner]")].filter((el) => el.matches("[role=banner]") || !el.closest("article, section, main, aside, nav")).length,
              main: document.querySelectorAll("main, [role=main]").length,
              nav: document.querySelectorAll("[data-testid=shell-nav]").length,
              h1: [...document.querySelectorAll("h1")].filter((h) => h.checkVisibility()).length,
              // A control with nothing a screen reader can say for it.
              unnamed: [...document.querySelectorAll<HTMLElement>("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=switch], [role=button]")]
                .filter((el) => el.checkVisibility())
                .filter((el) => {
                  const named = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || (el as HTMLInputElement).labels?.length || el.getAttribute("title");
                  return !named && !(el.textContent ?? "").trim() && !el.querySelector("img[alt]:not([alt=''])");
                })
                .map((el) => el.outerHTML.slice(0, 80)),
              // The page's language and direction are what the page says, so a screen reader picks the voice.
              lang: document.documentElement.lang,
              dir: document.documentElement.dir,
            }));
            const problems: unknown[] = [...rules];
            if (counts.banner !== 1 || counts.main !== 1 || counts.nav !== 1 || counts.h1 !== 1) problems.push(counts);
            if (counts.unnamed.length > 0) problems.push({ unnamed: counts.unnamed });
            if (!counts.lang || !counts.dir) problems.push({ lang: counts.lang, dir: counts.dir });
            if (problems.length > 0) found[entry.name] = problems;
          } finally {
            await close();
          }
        }
        expect(found).toEqual({});
      });
    }
  }
});

test.describe("focus order", () => {
  for (const lang of ["en", "ur"] as const) {
    for (const basic of [false, true]) {
      for (const name of ["home", "directory", "my choices", "be ready", "choose groups"]) {
        test(`${lang}, ${basic ? "basic" : "normal"} mode, ${name}: Tab visits the controls in the order of the page, header first, then the navigation and the footer last`, async ({ page }) => {
          const entry = PAGES.find((p) => p.name === name)!;
          await open(page, entry, lang, basic, 390);
          const order = await page.evaluate(() => {
            const selector = "a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex]";
            const focusable = [...document.querySelectorAll<HTMLElement>(selector)].filter(
              (el) => el.checkVisibility() && !(el as HTMLButtonElement).disabled && el.tabIndex >= 0 && !el.closest("[inert], dialog:not([open])"),
            );
            const positive = [...document.querySelectorAll<HTMLElement>("[tabindex]")].filter((el) => el.tabIndex > 0).length;
            focusable.forEach((el, i) => el.setAttribute("data-tab-index", String(i)));
            return { count: focusable.length, positive };
          });
          expect(order.positive, "no positive tabindex").toBe(0);
          expect(order.count).toBeGreaterThan(4);

          const visited: number[] = [];
          for (let i = 0; i < order.count; i++) {
            await page.keyboard.press("Tab");
            visited.push(Number(await page.evaluate(() => document.activeElement?.getAttribute("data-tab-index") ?? "-1")));
          }
          expect(visited, "Tab reaches each control once, in document order").toEqual([...visited.keys()]);

          const first = await page.evaluate(() => document.querySelector<HTMLElement>('[data-tab-index="0"]')?.getAttribute("data-testid"));
          const second = await page.evaluate(() => document.querySelector<HTMLElement>('[data-tab-index="1"]')?.getAttribute("data-testid"));
          // The page ends with the bottom navigation and then the footer (staff sign-in, terms and privacy), in that order on screen and for Tab.
          const tail = await page.evaluate((count) => {
            const at = (index: number) => document.querySelector(`[data-tab-index="${index}"]`);
            const footer = [...Array(count).keys()].filter((index) => at(index)?.closest(".shell-footer"));
            const lastBeforeFooter = footer.length > 0 ? Math.min(...footer) - 1 : count - 1;
            return { footer, footerIsLast: footer.every((index, i) => index === count - footer.length + i), lastBeforeFooterInNav: !!at(lastBeforeFooter)?.closest("[data-testid=shell-nav]") };
          }, order.count);
          // The header's language button and then its display settings (Aa) button come first.
          expect([first, second]).toEqual(["shell-lang-button", "display-settings-button"]);
          expect(tail.footer.length, "the footer's two links").toBe(2);
          expect(tail.footerIsLast, "the footer's links are the last controls").toBe(true);
          expect(tail.lastBeforeFooterInNav, "the bottom navigation comes right before the footer").toBe(true);
        });
      }
    }
  }

  test("the language sheet takes focus when it opens, keeps it inside, and gives it back to the button when it closes", async ({ page }) => {
    await open(page, PAGES[0], "en", false, 390);
    await page.getByTestId("shell-lang-button").click();
    await expect(page.getByTestId("shell-lang-sheet")).toBeVisible();
    // A modal dialog holds focus: Tab goes round its controls (and through the browser's own bar), never to the page behind it.
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement === document.body || !!document.activeElement?.closest("dialog"))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shell-lang-sheet")).toBeHidden();
    await expect(page.getByTestId("shell-lang-button")).toBeFocused();
  });
});

test.describe("touch targets at 320 px", () => {
  for (const lang of LANGS) {
    for (const basic of [false, true]) {
      test(`${lang}, ${basic ? "basic (56 px)" : "normal (44 px)"} mode: every control meets the target size and the spacing`, async ({ browser, baseURL }) => {
        test.setTimeout(240_000);
        const found: Record<string, string[]> = {};
        for (const entry of PAGES) {
          const { page: tab, close } = await freshPage(browser, baseURL, 320);
          try {
            await open(tab, entry, lang, basic, 320);
            const minimum = await tab.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--tap-current").trim());
            expect(minimum).toBe(basic ? "56px" : "44px");
            const bad = [...(await tapViolations(tab)), ...(await targetSpacingViolations(tab))];
            if (bad.length > 0) found[entry.name] = bad;
          } finally {
            await close();
          }
        }
        expect(found).toEqual({});
      });
    }
  }
});

test.describe("axe-core on states that open after a tap", () => {
  for (const lang of LANGS) {
    for (const basic of [false, true]) {
      test(`${lang}, ${basic ? "basic" : "normal"} mode: the language sheet open, and the alert thread after "Earlier updates"`, async ({ browser, baseURL }) => {
        test.setTimeout(120_000);
        const found: Record<string, Found[]> = {};
        const sheet = await freshPage(browser, baseURL, 390);
        try {
          await open(sheet.page, PAGES[0], lang, basic, 390);
          await sheet.page.getByTestId("shell-lang-button").click();
          await expect(sheet.page.getByTestId("shell-lang-sheet")).toBeVisible();
          const violations = await axeRun(sheet.page, { tags: WCAG }, ["serious", "critical"]);
          if (violations.length > 0) found["language sheet"] = violations;
        } finally {
          await sheet.close();
        }
        if (basic) {
          const thread = await freshPage(browser, baseURL, 390);
          try {
            await open(thread.page, PAGES.find((p) => p.name === "alert")!, lang, true, 390);
            const more = thread.page.getByTestId("alert-earlier-more");
            if (await more.isVisible()) await more.click();
            const violations = await axeRun(thread.page, { tags: WCAG }, ["serious", "critical"]);
            if (violations.length > 0) found["alert thread, all entries"] = violations;
          } finally {
            await thread.close();
          }
        }
        expect(found).toEqual({});
      });
    }
  }
});

