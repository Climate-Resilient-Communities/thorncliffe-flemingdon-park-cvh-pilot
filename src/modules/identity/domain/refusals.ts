import type { BootstrapRefusal } from "./bootstrap";
import type { NewAccountError } from "./newAccount";

/** Every refusal of the identity module's account actions, as a code (spine: Errors). */
export type IdentityRefusal =
  | NewAccountError
  | BootstrapRefusal
  | "username_taken"
  | "admin_exists"
  | "forbidden"
  | "unauthenticated"
  | "provider_error";

/** The catalog key of each refusal's message (src/i18n, from design/prototype/cvh/strings.en.screens.js). */
export const REFUSAL_MESSAGE_KEYS: Record<IdentityRefusal, string> = {
  username_invalid: "staff.people.errors.usernameInvalid",
  first_name_missing: "staff.people.errors.firstNameMissing",
  last_name_missing: "staff.people.errors.lastNameMissing",
  name_too_long: "staff.people.errors.nameTooLong",
  starting_password_empty: "staff.people.errors.startingPasswordEmpty",
  email_invalid: "staff.people.errors.emailInvalid",
  role_invalid: "staff.people.errors.roleInvalid",
  username_taken: "staff.people.errors.usernameTaken",
  admin_exists: "staff.people.errors.adminExists",
  bootstrap_incomplete: "staff.bootstrap.incomplete",
  forbidden: "staff.people.errors.forbidden",
  unauthenticated: "staff.people.errors.unauthenticated",
  provider_error: "staff.people.errors.providerError",
};

/** The form field a refusal is about, so the screen can show the message next to it. */
export const REFUSAL_FIELDS: Partial<Record<IdentityRefusal, "username" | "firstName" | "lastName" | "email" | "role">> = {
  username_invalid: "username",
  username_taken: "username",
  first_name_missing: "firstName",
  last_name_missing: "lastName",
  starting_password_empty: "firstName",
  email_invalid: "email",
  role_invalid: "role",
};
