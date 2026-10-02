import type { Page } from "@playwright/test";

/**
 * The tap rule (components/touch-target.md): every control, and every link outside running text,
 * is at least --tap (--tap-basic in basic mode) in both dimensions. A link inside a container marked
 * data-tap-exempt="inline-text" is exempt. Returns the selectors of the elements that fail.
 */
export async function tapViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const minimum = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tap-current"));
    return [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [role='button']")]
      .filter((element) => !(element.matches("a") && element.closest('[data-tap-exempt="inline-text"]')))
      .filter((element) => {
        const { width, height } = element.getBoundingClientRect();
        return width < minimum || height < minimum;
      })
      .map((element) => element.outerHTML.slice(0, 60));
  });
}
