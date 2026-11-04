// Where an author is in composing an alert (the prototype's O-02 step bar, UAT 2026-11-04: "inconsistent with the original"): what and where
// (the log form the compose page opens on), the message (the composer), who gets it (the audience pages, which keep their own links), then the
// second person's approval (FR-A15: the author submits; another person approves). Words and a number for every step, the current one marked
// for a screen reader; it is a picture of the flow, not a set of links. The words are made on the server (composeProgress), so the client
// components that draw it carry no catalog.

export const COMPOSE_STEPS = ["what", "message", "audience", "approval"] as const;
export type ComposeStep = (typeof COMPOSE_STEPS)[number];

export interface ComposeProgressView {
  label: string;
  steps: { id: ComposeStep; label: string; state: "done" | "current" | "next" }[];
}

/** The bar for `current`, in English (the Hub's language). */
export function composeProgress(current: ComposeStep, text: (key: string) => string): ComposeProgressView {
  const at = COMPOSE_STEPS.indexOf(current);
  return {
    label: text("staff.compose.progress.label"),
    steps: COMPOSE_STEPS.map((id, index) => ({ id, label: text(`staff.compose.progress.${id}`), state: index === at ? "current" : index < at ? "done" : "next" })),
  };
}

export function ComposeProgress({ view }: { view: ComposeProgressView }) {
  return (
    <nav aria-label={view.label} data-testid="compose-progress">
      <ol className="hub-progress">
        {view.steps.map((step, index) => (
          <li key={step.id} className={`hub-progress__step hub-progress__step--${step.state}`} aria-current={step.state === "current" ? "step" : undefined} data-step={step.id}>
            <span className="hub-progress__n" aria-hidden="true">
              {index + 1}
            </span>
            <span>{step.label}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
