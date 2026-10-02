"use client";

import type { ReactNode } from "react";
import { Words } from "../text/isolated";
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
  /** A string, or an element where the caller has isolated what needs it. */
  label: ReactNode;
  line?: string;
  /** The label and line are place text (an address, a neighbourhood), not the language of the page: shown as an isolated left-to-right run. */
  isolate?: boolean;
  /** The language of the label itself, for a language shown in its own name. */
  labelLang?: string;
  labelDir?: "ltr" | "rtl";
  testId?: string;
};

/** One choice: a native radio button or checkbox with its words. The whole row is the touch target. */
export function ChoiceOption({ kind, name, value, checked, onChange, label, line, isolate, labelLang, labelDir, testId }: OptionProps) {
  return (
    <label className="choice-option tap" data-testid={testId}>
      <input className="choice-option__input" type={kind} name={name} value={value} checked={checked} onChange={onChange} />
      <span className="choice-option__text">
        <span className="choice-option__label" lang={labelLang} dir={labelDir}>
          <Words isolate={isolate}>{label}</Words>
        </span>
        {line !== undefined && (
          <span className="choice-option__line">
            <Words isolate={isolate}>{line}</Words>
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

/**
 * A paragraph of words: a string of the catalog is the whole content of its <p>, so a fallback puts lang="en" dir="ltr" on
 * the paragraph itself (ResidentText as="p"); place text (`isolate`) or an element stays an isolated run inside it.
 */
export function Para({ className, testId, isolate, children }: { className?: string; testId?: string; isolate?: boolean; children: ReactNode }) {
  if (typeof children === "string" && !isolate) {
    return (
      <ResidentText as="p" className={className} testId={testId}>
        {children}
      </ResidentText>
    );
  }
  return (
    <p className={className} data-testid={testId}>
      <Words isolate={isolate}>{children}</Words>
    </p>
  );
}

type ToldRowProps = {
  /** A string, or an element where the caller has isolated what needs it. */
  label: ReactNode;
  caption?: string;
  /** The label and caption are place text (an address, a neighbourhood), shown as an isolated left-to-right run. */
  isolate?: boolean;
  remove: () => void;
  removeText: string;
  /** The button's aria-label, with its items isolated by the caller (isolatedInString). */
  removeLabel: string;
  testId: string;
};

/** One saved item on R-34 with its own Remove. */
export function ToldRow({ label, caption, isolate, remove, removeText, removeLabel, testId }: ToldRowProps) {
  return (
    <div className="choice-told__row" data-testid={testId}>
      <div>
        <Para className="choice-told__value" isolate={isolate}>
          {label}
        </Para>
        {caption !== undefined && (
          <Para className="choice-hint" isolate={isolate}>
            {caption}
          </Para>
        )}
      </div>
      <div className="choice-told__acts">
        <ChoiceButton variant="quiet" onClick={remove} ariaLabel={removeLabel}>
          {removeText}
        </ChoiceButton>
      </div>
    </div>
  );
}
