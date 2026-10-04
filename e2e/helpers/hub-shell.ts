import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { hubNavigation, hubShellLabels } from "../../src/app/staff/hubShell";
import { englishText } from "../../src/i18n/text";
import type { HubShellTexts } from "../layout/fixtures";
import { box, tokenPx } from "./hub-layout-boundaries";
import { longestLabels } from "./strings";

/** The Hub shell's fixture props: the brand images as data URIs (a page set with setContent has no base URL). */
export function hubBrand() {
  const dataUri = (file: string) => `data:image/png;base64,${readFileSync(path.join(__dirname, "..", "..", "public", "brand", file)).toString("base64")}`;
  return { logoSrc: dataUri("hub-logo.png"), symbolSrc: dataUri("hub-symbol.png") };
}

/**
 * The shell's real English words and menu: what hubShellLabels() and hubNavigation("admin") give the app, and the Hub
 * home's own heading and line, as an Admin sees them. Nothing here is written out by hand but the person's name.
 */
function realTexts(): HubShellTexts {
  const labels = hubShellLabels();
  return {
    appName: labels.appName,
    menu: labels.menu,
    closeMenu: labels.closeMenu,
    signedInAs: labels.signedInAs,
    role: labels.roles.admin,
    personName: "Priya Sharma",
    signOut: englishText("staff.signOut"),
    logoAlt: labels.logoAlt,
    navigation: hubNavigation("admin"),
    heading: englishText("staff.hub.title"),
    paragraphs: [englishText("staff.hub.lead")],
  };
}

export const REAL_TEXTS: HubShellTexts = realTexts();

/**
 * The longest translated labels of a language in every place the shell shows text: its longest sentences, its
 * longest words and one token that cannot break. The person's name is the longest sentence, which no real name
 * is, so the top bar has to wrap and grow. The menu keeps the real one's sections, items, hrefs and icons.
 */
export function longestTexts(lang: string): HubShellTexts {
  const { sentences, words, unbreakable } = longestLabels(lang);
  const sectionLabels = [sentences[2], unbreakable];
  const itemLabels = [unbreakable, words[0], sentences[0], words[1], sentences[1]];
  let next = 0;
  return {
    appName: sentences[2],
    menu: words[2],
    closeMenu: words[1],
    signedInAs: `${sentences[1]} {name}, {role}`,
    role: words[0],
    personName: sentences[0],
    signOut: sentences[1],
    logoAlt: sentences[2],
    navigation: REAL_TEXTS.navigation.map((section, index) => ({
      ...section,
      label: sectionLabels[index % sectionLabels.length],
      items: section.items.map((item) => ({ ...item, label: itemLabels[next++ % itemLabels.length] })),
    })),
    heading: sentences[0],
    paragraphs: [sentences[0], sentences[1], sentences[2]],
  };
}

export const LANGUAGES = [
  { lang: "en", dir: "ltr" },
  { lang: "ur", dir: "rtl" },
] as const;

/** The Hub breakpoint in px, as the tests state it (the app has it only in the theme's --breakpoint-hub). */
export const HUB_BREAKPOINT = 700;

export const sideNav = (page: Page) => page.getByTestId("hub-side");
export const topBar = (page: Page) => page.getByTestId("hub-top");
export const menuButton = (page: Page) => page.getByTestId("hub-menu-button");
export const drawer = (page: Page) => page.getByTestId("hub-drawer");

/** No horizontal overflow of the document, the page container and each part of the shell. */
export async function expectShellDoesNotOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const scrolls = (element: Element | null) => (element ? element.scrollWidth > element.clientWidth : false);
    return {
      document: scrolls(document.documentElement),
      body: scrolls(document.body),
      pageContainer: scrolls(document.querySelector(".layout-screen__body")),
      top: scrolls(document.querySelector("[data-testid=hub-top]")),
      main: scrolls(document.querySelector("[data-testid=hub-main]")),
      side: scrolls(document.querySelector("[data-testid=hub-side]")),
      sideLinks: scrolls(document.querySelector("[data-testid=hub-side] .hub-side__sticky")),
    };
  });
  expect(overflow, "nothing scrolls horizontally").toEqual({ document: false, body: false, pageContainer: false, top: false, main: false, side: false, sideLinks: false });
}

/** Every box of the locators is inside the viewport horizontally: reachable without scrolling sideways. */
export async function expectInsideViewport(page: Page, locators: Locator[]) {
  const width = page.viewportSize()!.width;
  for (const locator of locators) {
    const { left, right } = await box(locator);
    expect(left, `${await locator.evaluate((e) => e.outerHTML.slice(0, 50))} starts inside`).toBeGreaterThanOrEqual(-0.5);
    expect(right, `${await locator.evaluate((e) => e.outerHTML.slice(0, 50))} ends inside`).toBeLessThanOrEqual(width + 0.5);
  }
}

export async function topBarMinimum(page: Page) {
  return tokenPx(page, "--size-topbar-hub-min");
}
