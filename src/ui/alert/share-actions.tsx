"use client";

import { useState, useSyncExternalStore } from "react";
import { ResidentText } from "../text/resident-text";
import "../shell/icons.css";
import "./alert-icons.css";
import "./share.css";

export interface ShareLabels {
  send: string;
  copy: string;
  copied: string;
  copyFailed: string;
  whatsapp: string;
  noSheet: string;
}

type Sheet = "unknown" | "available" | "unavailable";
type Copy = "idle" | "copied" | "failed";

// What the phone offers cannot change while the page is open; the server render and the first render do not know it (undefined).
const noChange = () => () => undefined;
const phoneHasSheet = () => typeof navigator !== "undefined" && typeof navigator.share === "function";
const unknownOnServer = (): undefined => undefined;

/**
 * The share control (R-29, S05.08). Tapping "Share" opens the phone's own share sheet (the Web Share API) with the message; where the phone has none, or
 * refuses to open it, the same message is offered to copy and to send on WhatsApp (`https://wa.me/?text=…`, a plain link that opens in the resident's own app).
 * A resident who closes the sheet without choosing has changed nothing and is told nothing.
 *
 * Sharing is never recorded: nothing here makes a request. The message was composed on the server with the page, so the phone sends what was previewed, and no
 * event, count, address or choice about it goes anywhere (a test watches the network). The phone's capability is read after the page has loaded; until then
 * the one button that always makes sense, "Share", is what is drawn.
 */
export function ShareActions({ text, whatsapp, labels }: { text: string; whatsapp: string; labels: ShareLabels }) {
  const hasSheet = useSyncExternalStore(noChange, phoneHasSheet, unknownOnServer);
  const [refused, setRefused] = useState(false);
  const [copy, setCopy] = useState<Copy>("idle");
  const sheet: Sheet = hasSheet === undefined ? "unknown" : hasSheet && !refused ? "available" : "unavailable";

  async function share() {
    try {
      if (typeof navigator.canShare === "function" && !navigator.canShare({ text })) throw new TypeError("The phone cannot share this");
      await navigator.share({ text });
    } catch (error) {
      // The resident closing the sheet is an answer, not a failure; anything else means this phone's sheet is not usable here.
      if (!(error instanceof DOMException && error.name === "AbortError")) setRefused(true);
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }

  return (
    <div className="share-actions" data-testid="share-actions" data-sheet={sheet}>
      {sheet !== "unavailable" && (
        <button type="button" className="share-btn share-btn--primary" onClick={() => void share()} data-testid="share-send">
          <span className="alert-ico alert-ico--share shell-ico--mirror" aria-hidden="true" />
          <ResidentText>{labels.send}</ResidentText>
        </button>
      )}
      {sheet === "unavailable" && (
        <>
          <ResidentText as="p" className="alert-caption" testId="share-no-sheet">
            {labels.noSheet}
          </ResidentText>
          <button type="button" className="share-btn share-btn--primary" onClick={() => void copyText()} data-testid="share-copy">
            <ResidentText>{labels.copy}</ResidentText>
          </button>
          <a className="share-btn" href={whatsapp} target="_blank" rel="noopener noreferrer" data-testid="share-whatsapp">
            <ResidentText>{labels.whatsapp}</ResidentText>
          </a>
        </>
      )}
      <div role="status" data-testid="share-status">
        {copy === "copied" && (
          <ResidentText as="p" className="share-status">
            {labels.copied}
          </ResidentText>
        )}
        {copy === "failed" && (
          <ResidentText as="p" className="share-status">
            {labels.copyFailed}
          </ResidentText>
        )}
      </div>
    </div>
  );
}
