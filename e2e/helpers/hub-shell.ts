import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import type { HubShellTexts } from "../layout/fixtures";
import { box, tokenPx } from "./hub-layout-boundaries";
import { longestLabels } from "./strings";

/** The Hub shell's fixture props: the brand images as data URIs (a page set with setContent has no base URL). */
export function hubBrand() {
  const dataUri = (file: string) => `data:image/png;base64,${readFileSync(path.join(__dirname, "..", "..", "public", "brand", file)).toString("base64")}`;
  return { logoSrc: dataUri("hub-logo.png"), symbolSrc: dataUri("hub-symbol.png") };
}

/** The shell's real English words (from the catalog), as a coordinator sees them. */
export const REAL_TEXTS: HubShellTexts = {
  appName: "Hub and partner space",
  menu: "Menu",
  closeMenu: "Close menu",
  signedInAs: "Signed in as {name}, {role}",
  role: "Coordinator",
  personName: "Priya Sharma",
  signOut: "Sign out",
  logoAlt: "Thorncliffe Park Community Hub",
  sections: ["In a disruption", "Administration"],
  items: ["Incidents", "Compose an alert", "Moderation", "Check-in rounds", "People"],
  heading: "Right now",
  paragraphs: ["Open incidents, most recent first. Anything waiting for you is at the top."],
};

/**
 * The longest translated labels of a language in every place the shell shows text: its longest sentences, its
 * longest words and one token that cannot break. The person's name is the longest sentence, which no real name
 * is, so the top bar has to wrap and grow.
 */
export function longestTexts(lang: string): HubShellTexts {
  const { sentences, words, unbreakable } = longestLabels(lang);
  return {
    appName: sentences[2],
    menu: words[2],
    closeMenu: words[1],
    signedInAs: `${sentences[1]} {name}, {role}`,
    role: words[0],
    personName: sentences[0],
    signOut: sentences[1],
    logoAlt: sentences[2],
    sections: [sentences[2], unbreakable],
    items: [unbreakable, words[0], sentences[0], words[1], sentences[1]],
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
    };
  });
  expect(overflow, "nothing scrolls horizontally").toEqual({ document: false, body: false, pageContainer: false, top: false, main: false, side: false });
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
