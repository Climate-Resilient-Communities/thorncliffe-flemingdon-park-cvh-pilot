"use client";

import { useServerInsertedHTML } from "next/navigation";
import { useLayoutEffect, useRef } from "react";
import { choicesStore } from "../choices/choices-store";
import { applyBasic, BASIC_BOOT_SCRIPT, isBasic } from "./basic-mode";

/**
 * Basic mode (X-07, S02.14) from the first paint of every resident page, then kept equal to the saved choice while the page is
 * open: a switch in this page, R-34, or another tab. It renders nothing. A page reaches the screen in one of two ways:
 *
 * - Drawn by the server: BASIC_BOOT_SCRIPT goes into the response's <head> (useServerInsertedHTML, once per response), so it runs
 *   before the body is parsed. It also reaches the document Next sends when a page's render ends in notFound() or throws (the 404
 *   and error pages: `<html id="__next_error__">` with an empty body), which a <script> in the layout's <head> never reached,
 *   because the layout is not drawn on the server there.
 * - Drawn by React in the browser (those same 404 and error pages): React replaces every attribute of <html> with its own props
 *   when it takes the element over, so data-basic is set again in a layout effect, which runs once the header is in the
 *   document and before the browser paints it.
 */
export function BasicSync() {
  const sent = useRef(false);
  useServerInsertedHTML(() => {
    // Asked again at every flush of the stream: the script goes once, in the first (the one that closes <head>).
    if (sent.current) return null;
    sent.current = true;
    return <script dangerouslySetInnerHTML={{ __html: BASIC_BOOT_SCRIPT }} />;
  });
  useLayoutEffect(() => {
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
