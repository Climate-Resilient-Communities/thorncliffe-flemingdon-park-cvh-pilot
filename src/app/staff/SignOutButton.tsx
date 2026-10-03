"use client";

import { useState } from "react";
import { postStaffJson } from "./postJson";

/** Sign out (`POST /api/staff/sign-out`), then the sign-in page. Reachable at every setup gate. */
export function SignOutButton({ label }: { label: string }) {
  const [pending, setPending] = useState(false);
  return (
    <button
      className="hub-button hub-button--secondary"
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const result = await postStaffJson("/api/staff/sign-out", {});
        window.location.assign(result.ok ? result.next : "/staff/sign-in");
      }}
    >
      {label}
    </button>
  );
}
