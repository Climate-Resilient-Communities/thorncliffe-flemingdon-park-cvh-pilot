"use client";

import { useState, type FormEvent } from "react";
import { Stack } from "@/ui";
import { postStaffJson } from "../postJson";

export interface SignInLabels {
  username: string;
  password: string;
  submit: string;
  /** Shown when the answer carries no message (the network failed). */
  unavailable: string;
}

const ERROR_ID = "sign-in-error";

/** Staff sign-in (S01.07): username and password, then the page of the person's setup gate. */
export function SignInForm({ labels }: { labels: SignInLabels }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    const result = await postStaffJson("/api/staff/sign-in", { username: String(data.get("username") ?? ""), password: String(data.get("password") ?? "") });
    if (result.ok) {
      window.location.assign(result.next);
      return;
    }
    const password = form.elements.namedItem("password");
    if (password instanceof HTMLInputElement) password.value = "";
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
          <label htmlFor="username">{labels.username}</label>
          <input className="hub-input" id="username" name="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required aria-describedby={message ? ERROR_ID : undefined} />
        </Stack>
        <Stack gap="label">
          <label htmlFor="password">{labels.password}</label>
          <input className="hub-input" id="password" name="password" type="password" autoComplete="current-password" required aria-describedby={message ? ERROR_ID : undefined} />
        </Stack>
        <button className="hub-button hub-button--primary" type="submit" disabled={pending}>
          {labels.submit}
        </button>
      </Stack>
    </form>
  );
}
