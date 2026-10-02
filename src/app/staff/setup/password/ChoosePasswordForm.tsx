"use client";

import { useState, type FormEvent } from "react";
import { Stack } from "@/ui";
import { postStaffJson } from "../../postJson";

export interface ChoosePasswordLabels {
  password: string;
  passwordHint: string;
  confirm: string;
  submit: string;
  /** Shown when the answer carries no message (the network failed). */
  unavailable: string;
}

const ERROR_ID = "choose-password-error";
const HINT_ID = "password-hint";

/** "Choose your password" (gate 1): the new password twice; the server checks the rules. */
export function ChoosePasswordForm({ labels }: { labels: ChoosePasswordLabels }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    const result = await postStaffJson("/api/staff/password", { password: String(data.get("password") ?? ""), confirm: String(data.get("confirm") ?? "") });
    if (result.ok) {
      window.location.assign(result.next);
      return;
    }
    setMessage(result.message ?? labels.unavailable);
    setPending(false);
  }

  const described = (own?: string) => [own, message ? ERROR_ID : null].filter(Boolean).join(" ") || undefined;
  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="stack">
        {message && (
          <p id={ERROR_ID} role="alert" className="hub-error">
            {message}
          </p>
        )}
        <Stack gap="label">
          <label htmlFor="password">{labels.password}</label>
          <p id={HINT_ID}>{labels.passwordHint}</p>
          <input className="hub-input" id="password" name="password" type="password" autoComplete="new-password" required aria-describedby={described(HINT_ID)} />
        </Stack>
        <Stack gap="label">
          <label htmlFor="confirm">{labels.confirm}</label>
          <input className="hub-input" id="confirm" name="confirm" type="password" autoComplete="new-password" required aria-describedby={described()} />
        </Stack>
        <button className="hub-button hub-button--primary" type="submit" disabled={pending}>
          {labels.submit}
        </button>
      </Stack>
    </form>
  );
}
