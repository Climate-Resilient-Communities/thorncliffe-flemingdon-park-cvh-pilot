"use client";

import { useId, useRef, useState } from "react";
import { useChoices } from "../choices/use-choices";
import { isBasic, isLargeText, saveDisplayChoice } from "../basic/basic-mode";
import { ResidentText } from "../text/resident-text";

export type DisplaySettingsLabels = {
  title: string; close: string; textSize: string; standard: string; large: string;
  simpler: string; help: string; saved: string; sessionOnly: string;
};
const fallback: DisplaySettingsLabels = {
  title: "Display settings", close: "Done", textSize: "Text size", standard: "Standard", large: "Large",
  simpler: "Simpler view", help: "Show fewer details and use lists instead of the map. Text size stays the same.",
  saved: "Saved on this device.", sessionOnly: "Your browser cannot save this setting. It will last for this session only.",
};
export function DisplaySettings({ labels = fallback }: { labels?: DisplaySettingsLabels }) {
  const choices = useChoices();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const group = useId();
  const [status, setStatus] = useState("");
  const save = (change: Parameters<typeof saveDisplayChoice>[0]) => setStatus(saveDisplayChoice(change) ? labels.saved : labels.sessionOnly);
  return <>
    {/* The name is a hidden span, not aria-label, so a title that fell back to English is marked as English (ResidentText). */}
    <button className="shell-langbtn shell-display-button tap" type="button" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()} data-testid="display-settings-button">
      <span aria-hidden="true">Aa</span>
      <span className="sr-only"><ResidentText>{labels.title}</ResidentText></span>
    </button>
    <dialog ref={dialog} className="shell-sheet shell-display-sheet" aria-labelledby={title} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="shell-sheet__panel">
        <div className="shell-sheet__head">
          <h2 className="shell-sheet__title" id={title}><ResidentText>{labels.title}</ResidentText></h2>
          <button type="button" className="shell-langbtn tap" onClick={() => dialog.current?.close()}><ResidentText>{labels.close}</ResidentText></button>
        </div>
        <div className="shell-sheet__body">
          <fieldset className="display-size">
            <ResidentText as="legend">{labels.textSize}</ResidentText>
            <div className="display-size__choices">
              {(["standard", "large"] as const).map(size => <label className="tap" key={size}>
                <input type="radio" name={group} value={size} checked={(isLargeText(choices) ? "large" : "standard") === size} onChange={() => save({ textSize: size })} />
                <ResidentText>{labels[size]}</ResidentText>
              </label>)}
            </div>
          </fieldset>
          <label className="display-simpler tap"><input type="checkbox" data-testid="basic-switch" aria-checked={isBasic(choices)} checked={isBasic(choices)} onChange={event => save({ basic: event.target.checked })} /><ResidentText>{labels.simpler}</ResidentText></label>
          <ResidentText as="p">{labels.help}</ResidentText>
          <p role="status"><ResidentText>{status}</ResidentText></p>
        </div>
      </div>
    </dialog>
  </>;
}
