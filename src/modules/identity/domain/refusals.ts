import type { AdminFloorRefusal } from "./adminFloor";
import type { BootstrapRefusal } from "./bootstrap";
import type { NewAccountError } from "./newAccount";
import type { StaffChangeRefusal } from "./staffChange";

/** Every refusal of the identity module's account actions, as a code (spine: Errors). */
export type IdentityRefusal =
  | NewAccountError
  | BootstrapRefusal
  | AdminFloorRefusal
  | StaffChangeRefusal
  | "not_found"
  | "username_taken"
  | "admin_exists"
  | "forbidden"
  | "unauthenticated"
  | "provider_error"
  | "provider_rejected"
  /** STAFF_PASSWORD_PEPPER is not configured: no password can be given to the provider. */
  | "passwords_not_configured";

/** The catalog key of each refusal's message (src/i18n, from design/prototype/cvh/strings.en.screens.js). */
export const REFUSAL_MESSAGE_KEYS: Record<IdentityRefusal, string> = {
  username_invalid: "staff.people.errors.usernameInvalid",
  first_name_missing: "staff.people.errors.firstNameMissing",
  last_name_missing: "staff.people.errors.lastNameMissing",
  name_too_long: "staff.people.errors.nameTooLong",
  starting_password_empty: "staff.people.errors.startingPasswordEmpty",
  starting_password_unsupported_letter: "staff.people.errors.startingPasswordUnsupportedLetter",
  starting_password_too_long: "staff.people.errors.startingPasswordTooLong",
  email_invalid: "staff.people.errors.emailInvalid",
  role_invalid: "staff.people.errors.roleInvalid",
  username_taken: "staff.people.errors.usernameTaken",
  admin_exists: "staff.people.errors.adminExists",
  bootstrap_incomplete: "staff.bootstrap.incomplete",
  two_admin_rule: "staff.admins.twoAdminRule",
  self_action: "staff.people.errors.selfAction",
  account_removed: "staff.people.errors.accountRemoved",
  no_change: "staff.people.errors.noChange",
  not_found: "staff.people.errors.notFound",
  forbidden: "staff.people.errors.forbidden",
  unauthenticated: "staff.people.errors.unauthenticated",
  provider_error: "staff.people.errors.providerError",
  provider_rejected: "staff.people.errors.providerRejected",
  passwords_not_configured: "staff.people.errors.passwordsNotConfigured",
};

/** The form field a refusal is about, so the screen can show the message next to it. */
export const REFUSAL_FIELDS: Partial<Record<IdentityRefusal, "username" | "firstName" | "lastName" | "email" | "role">> = {
  username_invalid: "username",
  username_taken: "username",
  first_name_missing: "firstName",
  last_name_missing: "lastName",
  starting_password_empty: "firstName",
  starting_password_unsupported_letter: "firstName",
  starting_password_too_long: "firstName",
  email_invalid: "email",
  role_invalid: "role",
};
