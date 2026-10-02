"use client";

import type { ReactNode } from "react";
import { ResidentText } from "../text/resident-text";
import "./choices.css";

/** Where a step is shown: the first run (skippable, then on to the next step) or opened later from R-34 (saves, then back to R-34). */
export type StepMode = "first-run" | "later";

type OptionProps = {
  kind: "radio" | "checkbox";
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  line?: string;
  /** The language of the label itself, for a language shown in its own name. */
  labelLang?: string;
  labelDir?: "ltr" | "rtl";
  testId?: string;
};

/** One choice: a native radio button or checkbox with its words. The whole row is the touch target. */
export function ChoiceOption({ kind, name, value, checked, onChange, label, line, labelLang, labelDir, testId }: OptionProps) {
  return (
    <label className="choice-option tap" data-testid={testId}>
      <input className="choice-option__input" type={kind} name={name} value={value} checked={checked} onChange={onChange} />
      <span className="choice-option__text">
        <span className="choice-option__label" lang={labelLang} dir={labelDir}>
          <ResidentText>{label}</ResidentText>
        </span>
        {line !== undefined && (
          <span className="choice-option__line">
            <ResidentText>{line}</ResidentText>
          </span>
        )}
      </span>
    </label>
  );
}

type ButtonProps = {
  variant: "primary" | "secondary" | "quiet" | "danger";
  children: string;
  onClick: () => void;
  ariaLabel?: string;
  testId?: string;
};

export function ChoiceButton({ variant, children, onClick, ariaLabel, testId }: ButtonProps) {
  return (
    <button type="button" className={`choice-btn choice-btn--${variant} tap`} onClick={onClick} aria-label={ariaLabel} data-testid={testId}>
      <ResidentText>{children}</ResidentText>
    </button>
  );
}

/** The step's actions: first run is Skip and Continue, later is Cancel and Save. */
export function StepActions({ children }: { children: ReactNode }) {
  return <div className="choice-actions">{children}</div>;
}
