import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LAUNCH_LANGUAGES } from "../../src/i18n/languages";

export const LANGUAGES = LAUNCH_LANGUAGES;

/** The marker of a catalog string that has no translation yet and falls back to English (FALLBACK_MARKER in src/ui). */
export const FALLBACK = "[EN] ";

const catalogs = new Map<string, Record<string, unknown>>();

/**
 * A string of a language's generated catalog (src/i18n/messages/<lang>.json) by its full key, such as
 * `shell.pageNotFound`, exactly as the page gets it: translated, or English behind the [EN] marker. The tests read the
 * expected wording from here rather than writing it out, so translating a string does not break a test of behaviour.
 */
export function catalogText(lang: string, key: string): string {
  let catalog = catalogs.get(lang);
  if (!catalog) {
    const file = path.join(__dirname, "..", "..", "src", "i18n", "messages", `${lang}.json`);
    catalog = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    catalogs.set(lang, catalog);
  }
  const value = key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), catalog);
  if (typeof value !== "string") throw new Error(`The ${lang} catalog has no string ${key}`);
  return value;
}

/** True when a catalog string is English standing in for a missing translation. */
export const isFallback = (text: string) => text.startsWith(FALLBACK);

/** A pattern for a catalog string with one {placeholder} filled by anything: for a date whose wording the browser formats. */
export function filledPattern(template: string, placeholder: string): RegExp {
  const [before, after, ...rest] = template.split(`{${placeholder}}`);
  if (after === undefined || rest.length > 0) throw new Error(`"${template}" does not have {${placeholder}} once`);
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escape(before)}(.+)${escape(after)}$`);
}
export const WIDTHS = [320, 390, 768] as const;
/** A phone-shaped height for each test width. */
export const HEIGHTS: Record<(typeof WIDTHS)[number], number> = { 320: 640, 390: 844, 768: 1024 };

/** The Noto family each script needs (a page's <html data-script>); Latin languages need none: Public Sans carries them. */
export const SCRIPT_FAMILY: Record<string, string | null> = {
  latin: null,
  naskh: "Noto Naskh Arabic",
  gujarati: "Noto Sans Gujarati",
  tamil: "Noto Sans Tamil",
  greek: "Noto Sans",
  bengali: "Noto Sans Bengali",
  devanagari: "Noto Sans Devanagari",
  gurmukhi: "Noto Sans Gurmukhi",
  sc: "Noto Sans SC",
};

/**
 * Waits until every font file the visible text needs is loaded, not only until the fonts already requested are:
 * document.fonts.ready resolves at once when layout has not yet asked for a face, which is how a baseline was once
 * taken in a fallback serif. For each visible run of text this asks the browser to load the face (and the
 * unicode-range slices) that run uses, waits for all of them, then checks that the page's script family is loaded and
 * that no face is still loading.
 */
export async function waitForFonts(page: Page) {
  const { script, loaded, loading } = await page.evaluate(async () => {
    await document.fonts.ready;
    const requests: Promise<unknown>[] = [];
    const seen = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const element = node.parentElement;
      if (!text || !element?.checkVisibility()) continue;
      const style = getComputedStyle(element);
      const face = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      if (seen.has(face + text)) continue;
      seen.add(face + text);
      requests.push(document.fonts.load(face, text));
    }
    await Promise.all(requests);
    await document.fonts.ready;
    const faces = [...document.fonts];
    const family = (face: FontFace) => face.family.replace(/["']/g, "");
    return {
      script: document.documentElement.dataset.script ?? "latin",
      loaded: [...new Set(faces.filter((face) => face.status === "loaded").map(family))],
      loading: faces.filter((face) => face.status === "loading").map(family),
    };
  });
  const own = SCRIPT_FAMILY[script];
  if (loading.length > 0) throw new Error(`fonts still loading: ${loading.join(", ")}`);
  if (own && !loaded.includes(own)) throw new Error(`the ${script} page did not load ${own} (loaded: ${loaded.join(", ") || "none"})`);
}

/** Opens a resident page and waits until the fonts its text uses are loaded, so text has its final size. */
export async function openResident(page: Page, path: string, width: number, height = HEIGHTS[width as keyof typeof HEIGHTS] ?? 844) {
  await page.setViewportSize({ width, height });
  const response = await page.goto(path);
  await waitForFonts(page);
  return response;
}

/** The elements whose mirrored placement the tests compare: the same in every language. */
export const SHELL_PARTS = [
  "shell-header",
  "shell-logo",
  "shell-lang-button",
  "display-settings-button",
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

/**
 * True only inside the pinned Playwright image (scripts/resident-docker.sh sets it). Baseline screenshots are made
 * and compared in that one operating system, because text is rasterised by the OS and differs by 1 to 2 percent of
 * the pixels elsewhere.
 */
export const IN_PINNED_IMAGE = process.env.RESIDENT_PINNED_IMAGE === "1";

/**
 * Compares the page with its committed baseline in the pinned image. Elsewhere only this comparison is skipped,
 * with a note on the test; every other assertion of the test still runs.
 */
export async function expectBaseline(page: Page, name: string) {
  if (!IN_PINNED_IMAGE) {
    test.info().annotations.push({
      type: "screenshot skipped",
      description: `${name} is compared only inside the pinned image: npm run test:resident:docker`,
    });
    return;
  }
  await expect.soft(page).toHaveScreenshot(name); // TEMPORARY: soft to collect every new baseline in one CI run
}
