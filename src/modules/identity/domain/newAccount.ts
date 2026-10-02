import { isStaffRole, type StaffRole } from "../../../contracts/staffRoles";
import { err, ok, type Result } from "./result";
import { deriveStartingPassword } from "./startingPassword";

/**
 * The sign-in login of an account in Supabase Auth, made from its username. Supabase Auth signs
 * in with an email address or a phone number, and staff sign in with a username (AD-4), so each
 * auth user's email is `<username>@<STAFF_LOGIN_DOMAIN>`. `.invalid` is reserved (RFC 2606) and can
 * never receive mail, so the Hub cannot send any by mistake; the person's real email is stored only
 * on staff_account as a contact detail. S01.07 signs in by turning the username into this login.
 */
export const STAFF_LOGIN_DOMAIN = "staff.cvh.invalid";

export function loginForUsername(username: string): string {
  return `${username}@${STAFF_LOGIN_DOMAIN}`;
}

/** 3 to 32 characters: a letter first, then letters and digits, with single `.`, `_` or `-` between them. */
const USERNAME = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MAX = 100;

/** Usernames are compared and stored in lower case, so "JDoe" and "jdoe" are the same username. */
export function normaliseUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** Trims a name and collapses runs of white space to one space. */
export function normaliseName(name: string): string {
  return name.trim().replace(/\s+/gu, " ");
}

export interface NewAccountInput {
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

export interface NewAccount {
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  role: StaffRole;
  startingPassword: string;
}

export type NewAccountError =
  | "username_invalid"
  | "first_name_missing"
  | "last_name_missing"
  | "name_too_long"
  | "starting_password_empty"
  | "email_invalid"
  | "role_invalid";

/** Validates and normalises a new account, and derives its starting password. Checks fields in form order. */
export function validateNewAccount(input: NewAccountInput): Result<NewAccount, NewAccountError> {
  const username = normaliseUsername(input.username);
  if (username.length < 3 || username.length > 32 || !USERNAME.test(username)) return err("username_invalid");

  const firstName = normaliseName(input.firstName);
  const lastName = normaliseName(input.lastName);
  if (firstName === "") return err("first_name_missing");
  if (lastName === "") return err("last_name_missing");
  if (firstName.length > NAME_MAX || lastName.length > NAME_MAX) return err("name_too_long");
  const startingPassword = deriveStartingPassword(firstName, lastName);
  if (!startingPassword.ok) return startingPassword;

  const email = input.email.trim();
  if (email.length > 254 || !EMAIL.test(email)) return err("email_invalid");

  if (!isStaffRole(input.role)) return err("role_invalid");

  return ok({ username, firstName, lastName, email, role: input.role, startingPassword: startingPassword.value });
}
