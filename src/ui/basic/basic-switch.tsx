"use client";

import { useId } from "react";
import { useChoices } from "../choices/use-choices";
import { ResidentText } from "../text/resident-text";
import { isBasic, saveBasicChoice } from "./basic-mode";

export type BasicSwitchProps = {
  /** Translated text, passed in so this client component carries no catalog. */
  labels: { label: string; on: string; off: string };
};

/**
 * X-07, the basic-mode switch of the header: a native button with role="switch", so a screen reader says its name,
 * "switch" and its state in words (aria-checked). The name is the label alone; the state is also written after it for
 * sighted users (hidden from the accessibility tree so it is not said twice), and never by the track's colour alone.
 * Before hydration the server renders "off": a page opened in basic mode is announced as off until the script runs. The choice is saved in device choices only.
 */
export function BasicSwitch({ labels }: BasicSwitchProps) {
  const on = isBasic(useChoices());
  const labelId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelId}
      className="shell-switch tap"
      data-testid="basic-switch"
      onClick={() => saveBasicChoice(!on)}
    >
      <span className="shell-switch__track" aria-hidden="true">
        <span className="shell-switch__knob" />
      </span>
      <span className="shell-switch__text">
        <span id={labelId}>
          <ResidentText>{labels.label}</ResidentText>
        </span>
        {" "}
        <span className="shell-switch__state" aria-hidden="true">
          <ResidentText>{on ? labels.on : labels.off}</ResidentText>
        </span>
      </span>
    </button>
  );
}
