import type { StaffAccount } from "./staffAccount";

/**
 * A starting password is valid for 72 hours from issue (epic E01 definitions; 24 hours until the
 * product owner changed it on 2026-10-08).
 */
export const STARTING_PASSWORD_VALID_MS = 72 * 60 * 60_000;

/**
 * Where an account's starting password stands at `now`:
 *  - `none`: the person has chosen their own password;
 *  - `valid`: issued less than 72 hours ago and not yet used to sign in;
 *  - `used`: already used for its one successful sign-in (valid once, AD-4);
 *  - `expired`: unused 72 hours after issue, or the account is already `locked_pending_reissue`.
 */
export type StartingPasswordStanding = "none" | "valid" | "used" | "expired";

export function startingPasswordStanding(
  account: Pick<StaffAccount, "status" | "mustChangePassword" | "startingPasswordIssuedAt" | "startingPasswordUsedAt">,
  now: Date,
): StartingPasswordStanding {
  if (!account.mustChangePassword) return "none";
  if (account.status === "locked_pending_reissue") return "expired";
  if (account.startingPasswordUsedAt !== null) return "used";
  const issued = account.startingPasswordIssuedAt;
  if (issued === null || now.getTime() - issued.getTime() >= STARTING_PASSWORD_VALID_MS) return "expired";
  return "valid";
}
