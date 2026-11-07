"use client";

import { useActionState } from "react";
import { applySubmissionAction } from "./actions";
import type { ApplyState } from "./residents";

const IDLE: ApplyState = { status: "idle" };

/**
 * "Mark as done" on a suggestion from residents (PRD §6.3), wired to its server action: a plain form action, so it works before any script has
 * run. Its answer is a live region; the list is read again after a done one, and this item leaves it.
 */
export function ApplyForm({ id, label, ariaLabel }: { id: string; label: string; ariaLabel: string }) {
  const [answer, apply, pending] = useActionState(applySubmissionAction, IDLE);
  return (
    <form action={apply}>
      <input type="hidden" name="id" value={id} />
      <div aria-live="polite">{answer.status === "done" && <p>{answer.message}</p>}</div>
      {answer.status === "refused" && (
        <p role="alert" className="hub-error" data-testid="from-residents-error">
          {answer.message}
        </p>
      )}
      <button className="hub-button hub-button--secondary" type="submit" disabled={pending} aria-label={ariaLabel} data-testid="from-residents-done">
        {label}
      </button>
    </form>
  );
}
