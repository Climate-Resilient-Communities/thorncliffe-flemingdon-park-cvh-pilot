"use client";

import { useEffect, useState } from "react";
import { ResidentText } from "@/ui";
import { GUIDE_PARTS, headingId } from "./sections";

/**
 * Opens the guide at the section its link names. A link ends in `#before`, `#during` or `#after`: the browser scrolls
 * to the section's own id, and this moves the focus to the section's heading as well, so a keyboard or a screen reader
 * starts reading at "During", not at the top of the page. It also does so when a "Jump to" link changes the hash later.
 * (The page is server-rendered and reads no hash: this runs in the browser once the page has loaded.)
 *
 * When the guide was opened at "During" by its link (an alert says it is happening now), it also says so, as the prototype does.
 */
export function GuideHashFocus({ openedDuring }: { openedDuring: string }) {
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    const focusSection = (): string | null => {
      let id = "";
      try {
        id = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return null;
      }
      if (!(GUIDE_PARTS as readonly string[]).includes(id)) return null;
      const heading = document.getElementById(headingId(id));
      if (!heading) return null;
      heading.scrollIntoView({ block: "start" });
      heading.focus({ preventScroll: true });
      return id;
    };
    // Once, when the page opens: setting the state in the first run is the point (the note shows only for the opening link).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (focusSection() === "during") setOpened(true);
    const onHashChange = () => {
      focusSection();
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return opened ? (
    <ResidentText as="p" className="guide-opened" testId="guide-opened-during">
      {openedDuring}
    </ResidentText>
  ) : null;
}
