import type { Page } from "@playwright/test";
import { LAUNCH_LANGUAGES } from "../../src/i18n/languages";

export const LANGUAGES = LAUNCH_LANGUAGES;
export const WIDTHS = [320, 390, 768] as const;
/** A phone-shaped height for each test width. */
export const HEIGHTS: Record<(typeof WIDTHS)[number], number> = { 320: 640, 390: 844, 768: 1024 };

/** Opens a resident page and waits until the fonts it uses are loaded, so text has its final size. */
export async function openResident(page: Page, path: string, width: number, height = HEIGHTS[width as keyof typeof HEIGHTS] ?? 844) {
  await page.setViewportSize({ width, height });
  const response = await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
  return response;
}

/** The elements whose mirrored placement the tests compare: the same in every language. */
export const SHELL_PARTS = [
  "shell-header",
  "shell-logo",
  "shell-lang-button",
  "shell-main",
  "shell-nav",
  "shell-nav-now",
  "shell-nav-help",
  "shell-nav-map",
  "shell-nav-ready",
] as const;

export type Box = { left: number; right: number; top: number; width: number; height: number };

/** The boxes of the shell parts and of the screen inside the main (its body, heading and paragraph). */
export async function shellBoxes(page: Page): Promise<Record<string, Box>> {
  return page.evaluate((parts) => {
    const read = (element: Element | null): Box => {
      const r = element!.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, width: r.width, height: r.height };
    };
    const boxes: Record<string, Box> = {};
    for (const part of parts) boxes[part] = read(document.querySelector(`[data-testid="${part}"]`));
    boxes["screen-body"] = read(document.querySelector(".layout-screen__body"));
    boxes["screen-heading"] = read(document.querySelector("main h1"));
    boxes["screen-text"] = read(document.querySelector("main p"));
    return boxes;
  }, SHELL_PARTS);
}
