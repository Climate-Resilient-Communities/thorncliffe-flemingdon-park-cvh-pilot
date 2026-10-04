import type { Page } from "@playwright/test";

const TARGETS = "a[href], button, input, select, textarea, summary, [role='button'], [role='switch']";

/**
 * The tap rule (components/touch-target.md): every control, and every link outside running text,
 * is at least --tap (--tap-basic in basic mode) in both dimensions. A link inside a container marked
 * data-tap-exempt="inline-text" is exempt. A control that is not on screen (display: none, hidden, closed dialog or
 * disclosure) is not a target. A radio or a checkbox inside a label is measured through the label, which is what is tapped
 * (the input is the size of an icon). Returns the selectors of the elements that fail.
 */
export async function tapViolations(page: Page): Promise<string[]> {
  return page.evaluate((selector) => {
    const minimum = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tap-current"));
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => element.checkVisibility())
      .filter((element) => !(element.matches("a") && element.closest('[data-tap-exempt="inline-text"]')))
      .map((element) => {
        const own = element.getBoundingClientRect();
        const label = element instanceof HTMLInputElement && /^(radio|checkbox)$/.test(element.type) ? element.closest("label") : null;
        return { element, rect: label ? label.getBoundingClientRect() : own };
      })
      .filter(({ rect }) => rect.width < minimum || rect.height < minimum)
      .map(({ element }) => element.outerHTML.slice(0, 80));
  }, TARGETS);
}

/**
 * Adjacent targets (touch-target.md): two targets that do not overlap are at least --gap-target apart, or each is at
 * least --tap in both dimensions. A target inside another (a link in a card that is itself a link area) is not adjacent to it.
 */
export async function targetSpacingViolations(page: Page): Promise<string[]> {
  return page.evaluate((selector) => {
    const root = getComputedStyle(document.documentElement);
    const tap = parseFloat(root.getPropertyValue("--tap-current"));
    const probe = document.createElement("div");
    probe.style.inlineSize = "var(--gap-target)";
    document.body.append(probe);
    const gap = probe.getBoundingClientRect().width;
    probe.remove();
    const targets = [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => element.checkVisibility())
      .filter((element) => !(element.matches("a") && element.closest('[data-tap-exempt="inline-text"]')))
      .map((element) => {
        const label = element instanceof HTMLInputElement && /^(radio|checkbox)$/.test(element.type) ? element.closest("label") : null;
        const full = (label ?? element).getBoundingClientRect();
        // What is scrolled out of the main area is not on screen, and so not next to anything.
        const clip = element.closest("main")?.getBoundingClientRect();
        const rect = clip
          ? new DOMRect(Math.max(full.left, clip.left), Math.max(full.top, clip.top), Math.max(0, Math.min(full.right, clip.right) - Math.max(full.left, clip.left)), Math.max(0, Math.min(full.bottom, clip.bottom) - Math.max(full.top, clip.top)))
          : full;
        return { element, rect, full };
      })
      .filter(({ rect }) => rect.width >= 2 && rect.height >= 2);
    const found: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        const a = targets[i];
        const b = targets[j];
        if (a.element.contains(b.element) || b.element.contains(a.element)) continue;
        const dx = Math.max(b.rect.left - a.rect.right, a.rect.left - b.rect.right, 0);
        const dy = Math.max(b.rect.top - a.rect.bottom, a.rect.top - b.rect.bottom, 0);
        const overlap = dx === 0 && dy === 0 && a.rect.left < b.rect.right && b.rect.left < a.rect.right && a.rect.top < b.rect.bottom && b.rect.top < a.rect.bottom;
        const big = (r: DOMRect) => r.width >= tap && r.height >= tap;
        // A target is checked once, as a whole: a pair is judged by the sizes of the targets themselves.
        if (overlap) {
          found.push(`overlap: ${a.element.outerHTML.slice(0, 60)} | ${b.element.outerHTML.slice(0, 60)}`);
        } else if (Math.hypot(dx, dy) < gap && !(big(a.full) && big(b.full))) {
          found.push(`close: ${a.element.outerHTML.slice(0, 60)} | ${b.element.outerHTML.slice(0, 60)}`);
        }
      }
    }
    return found;
  }, TARGETS);
}
