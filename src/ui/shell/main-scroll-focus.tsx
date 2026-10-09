"use client";

import { useEffect } from "react";

/** What a keyboard can land on inside the main (anything that takes a Tab). */
const FOCUSABLE = 'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, iframe, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
/** Marks a tab stop this component added, so it only ever takes away its own. */
const MARK = "data-scroll-stop";

/**
 * Whether the main needs to be a tab stop of its own: it scrolls, and nothing inside it can take focus, so a keyboard could
 * not scroll it otherwise (WCAG 2.1.1; axe's scrollable-region-focusable; production UAT, 2026-10-08: an Urdu building page
 * at 390 px, whose longer text scrolls and which has no link).
 */
export function needsScrollStop(scrolls: boolean, hasFocusable: boolean): boolean {
  return scrolls && !hasFocusable;
}

function update(main: HTMLElement) {
  const overflow = getComputedStyle(main).overflowY;
  const scrolls = (overflow === "auto" || overflow === "scroll") && main.scrollHeight > main.clientHeight + 1;
  const hasFocusable = [...main.querySelectorAll(FOCUSABLE)].some((element) => element !== main);
  if (needsScrollStop(scrolls, hasFocusable)) {
    if (!main.hasAttribute("tabindex")) {
      main.setAttribute("tabindex", "0");
      main.setAttribute(MARK, "");
    }
  } else if (main.hasAttribute(MARK)) {
    main.removeAttribute("tabindex");
    main.removeAttribute(MARK);
  }
}

/**
 * Keeps the shell's main (the one scroll container on a phone) reachable by keyboard: a tab stop only while it scrolls with
 * nothing focusable inside it, so every other page keeps its Tab order. It renders nothing.
 */
export function MainScrollFocus({ mainId }: { mainId: string }) {
  useEffect(() => {
    const main = document.getElementById(mainId);
    if (!main) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => update(main));
    };
    schedule();
    const resize = new ResizeObserver(schedule);
    resize.observe(main);
    const content = new MutationObserver(() => {
      schedule();
      for (const child of main.children) resize.observe(child);
    });
    for (const child of main.children) resize.observe(child);
    content.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ["href", "tabindex", "disabled", "hidden"] });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      content.disconnect();
    };
  }, [mainId]);
  return null;
}
