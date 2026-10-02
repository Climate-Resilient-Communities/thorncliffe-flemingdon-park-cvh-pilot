"use client";

import { useState, type FormEvent } from "react";
import { Stack } from "@/ui";
import { postStaffJson } from "./postJson";

export interface AuthenticatorCodeLabels {
  code: string;
  submit: string;
  /** Shown when the answer carries no message (the network failed). */
  unavailable: string;
}

const ERROR_ID = "authenticator-code-error";

/**
 * An authenticator code (S01.10): the code that confirms a new authenticator, or this sign-in's
 * code. The server checks it (`POST /api/staff/factor/verify`) and names the next page.
 */
export function AuthenticatorCodeForm({ labels }: { labels: AuthenticatorCodeLabels }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    const result = await postStaffJson("/api/staff/factor/verify", { code: String(new FormData(form).get("code") ?? "") });
    if (result.ok) {
      window.location.assign(result.next);
      return;
    }
    const input = form.elements.namedItem("code");
    if (input instanceof HTMLInputElement) input.value = "";
    setMessage(result.message ?? labels.unavailable);
    setPending(false);
  }

  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="stack">
        {message && (
          <p id={ERROR_ID} role="alert" className="hub-error">
            {message}
          </p>
        )}
        <Stack gap="label">
          <label htmlFor="code">{labels.code}</label>
          <input
            className="hub-input"
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            required
            aria-describedby={message ? ERROR_ID : undefined}
          />
        </Stack>
        <button className="hub-button hub-button--primary" type="submit" disabled={pending}>
          {labels.submit}
        </button>
      </Stack>
    </form>
  );
}
