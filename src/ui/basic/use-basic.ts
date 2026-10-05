"use client";

import { useSyncExternalStore } from "react";
import { choicesStore } from "../choices/choices-store";
import { isBasic } from "./basic-mode";

/**
 * Whether basic mode is on for this phone: false on the server and in the first render, then what the saved choices say.
 * A screen that must not start something in basic mode (the map's tiles) also reads `<html data-basic>`, which the page set
 * before its first paint (BASIC_BOOT_SCRIPT), in its effect.
 */
export function useBasic(): boolean {
  return useSyncExternalStore(
    choicesStore.subscribe,
    () => isBasic(choicesStore.getSnapshot()),
    () => false,
  );
}

/** True when the page was opened in basic mode: `<html data-basic="true">`, set before the first paint. Browser only. */
export function basicAttributeSet(): boolean {
  return document.documentElement.getAttribute("data-basic") === "true";
}
