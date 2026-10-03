"use client";

import { useState } from "react";
import { FactorEnrolment, SIGN_IN_PAGE } from "@/contracts/staffAuth";
import { Stack } from "@/ui";
import { AuthenticatorCodeForm, type AuthenticatorCodeLabels } from "../../AuthenticatorCodeForm";
import { postStaffJsonAnswer } from "../../postJson";

export interface EnrolLabels {
  start: string;
  scan: string;
  qrAlt: string;
  /** "Key: {key}", with `{key}` replaced here. */
  key: string;
  keyHint: string;
  /** Shown when the answer carries no message (the network failed). */
  unavailable: string;
  code: AuthenticatorCodeLabels;
}

const ERROR_ID = "enrol-error";

/** The key in groups of four, as authenticator apps accept it typed with or without spaces. */
const grouped = (secret: string) => secret.replace(/(.{4})(?=.)/g, "$1 ");

/**
 * Gate 2 (S01.10): asks the server for a new authenticator (`POST /api/staff/factor/enrol`), shows
 * its QR code and key once, then takes the app's first code. Asking again replaces the key.
 */
export function EnrolAuthenticator({ labels }: { labels: EnrolLabels }) {
  const [enrolment, setEnrolment] = useState<FactorEnrolment | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function start() {
    setPending(true);
    setMessage(null);
    const result = await postStaffJsonAnswer("/api/staff/factor/enrol", {});
    setPending(false);
    if (result?.status === 401) {
      window.location.assign(SIGN_IN_PAGE);
      return;
    }
    const parsed = result && result.status === 200 ? FactorEnrolment.safeParse(result.answer) : null;
    if (parsed?.success) {
      setEnrolment(parsed.data);
      return;
    }
    setMessage(result && typeof result.answer.message === "string" ? result.answer.message : labels.unavailable);
  }

  return (
    <Stack gap="section-hub">
      {message && (
        <p id={ERROR_ID} role="alert" className="hub-error">
          {message}
        </p>
      )}
      {enrolment ? (
        <Stack gap="stack">
          <p>{labels.scan}</p>
          {enrolment.qrCode && (
            // A data URL from Supabase Auth: next/image would add nothing for an inline SVG.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={enrolment.qrCode} alt={labels.qrAlt} width={200} height={200} />
          )}
          <p>
            <code data-testid="authenticator-key">{labels.key.replace("{key}", grouped(enrolment.secret))}</code>
          </p>
          <p>{labels.keyHint}</p>
          <AuthenticatorCodeForm labels={labels.code} />
        </Stack>
      ) : (
        <button className="hub-button hub-button--primary" type="button" disabled={pending} onClick={start} aria-describedby={message ? ERROR_ID : undefined}>
          {labels.start}
        </button>
      )}
    </Stack>
  );
}
