"use client";

import { useEffect } from "react";
import { choicesStore } from "../choices/choices-store";
import { applyBasic, isBasic } from "./basic-mode";

/**
 * Keeps <html data-basic> equal to the saved choice while the page is open: a switch in this page, R-34, or another tab.
 * The first paint is not this component's job (BASIC_BOOT_SCRIPT sets the attribute before it); this takes over once
 * the page is interactive. It renders nothing.
 */
export function BasicSync() {
  useEffect(() => {
    const sync = () => {
      const choices = choicesStore.getSnapshot();
      applyBasic(document.documentElement, isBasic(choices));
      if (choices?.textSize) document.documentElement.setAttribute("data-text-size", choices.textSize);
      else document.documentElement.removeAttribute("data-text-size");
    };
    sync();
    return choicesStore.subscribe(sync);
  }, []);
  return null;
}
