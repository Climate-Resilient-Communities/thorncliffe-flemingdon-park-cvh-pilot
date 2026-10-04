"use client";

import { useEffect, useState } from "react";
import { useOnline, useServedKeptAt } from "../offline/kept-state";
import { ResidentText } from "../text/resident-text";
import { clockOffsetMs, isOfflineView, mayHaveEnded, receivedAtFor } from "./may-have-ended";
import "./alert.css";

/**
 * The alert's "Valid until ..." line (R-07), and the one thing that can replace it (S05.07, NFR-N3): when the page on screen is not the server's answer (a copy kept without
 * signal, or the phone has lost signal since it loaded) and the alert's valid-until has passed by the server's clock as the phone last knew it (`serverNow` against the phone's
 * clock when the copy was made: the page's own `<meta>` says when a kept copy was stored, a page loaded with signal was made when it loaded), the line is replaced by
 * "This alert may have ended. Check again when you have signal". It is never "current" past its time. With signal and the server's own page, it is the plain line.
 */
export function ValidLine({ valid, validUntil, serverNow, note }: { valid: string | null; validUntil: string; serverNow: string; note: string }) {
  const online = useOnline();
  const keptAt = useServedKeptAt();
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState<number | null>(null);
  const offline = isOfflineView({ online, servedKeptAt: keptAt });

  useEffect(() => {
    if (!offline) return;
    const tick = () => setNow(Date.now());
    const soon = setTimeout(tick, 0);
    const timer = setInterval(tick, 30_000);
    return () => {
      clearTimeout(soon);
      clearInterval(timer);
    };
  }, [offline]);

  // When the phone got this page: the kept copy's own time, or when this view mounted (the page was built just before), not when the document loaded.
  const receivedAt = receivedAtFor({ servedKeptAt: keptAt, mountedAt });
  if (offline && now !== null && mayHaveEnded(validUntil, { now, offsetMs: clockOffsetMs(serverNow, receivedAt) })) {
    return (
      <div className="alert-note" role="note" data-testid="alert-may-have-ended">
        <ResidentText as="p">{note}</ResidentText>
      </div>
    );
  }
  return valid === null ? null : (
    <ResidentText as="p" className="alert-caption" testId="alert-valid">
      {valid}
    </ResidentText>
  );
}
