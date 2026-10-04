"use client";

import { useChoices } from "../choices/use-choices";
import { ResidentText } from "../text/resident-text";
import { isBasic, saveBasicChoice } from "./basic-mode";

export type BasicSwitchProps = {
  /** Translated text, passed in so this client component carries no catalog. */
  labels: { label: string; on: string; off: string };
};

/**
 * X-07, the basic-mode switch of the header: a native button with role="switch", so a screen reader says its name,
 * "switch" and its state in words. The state is also written after the name, so it is read where the role is not
 * announced, and is never shown by the track's colour alone. The choice is saved in device choices only.
 */
export function BasicSwitch({ labels }: BasicSwitchProps) {
  const on = isBasic(useChoices());
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="shell-switch tap"
      data-testid="basic-switch"
      onClick={() => saveBasicChoice(!on)}
    >
      <span className="shell-switch__track" aria-hidden="true">
        <span className="shell-switch__knob" />
      </span>
      <span className="shell-switch__text">
        <ResidentText>{labels.label}</ResidentText>
        <span className="sr-only">: </span>{" "}
        <span className="shell-switch__state">
          <ResidentText>{on ? labels.on : labels.off}</ResidentText>
        </span>
      </span>
    </button>
  );
}
