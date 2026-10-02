import { englishText } from "@/i18n/text";
import { REFUSAL_FIELDS, REFUSAL_MESSAGE_KEYS, type AccountService } from "@/modules/identity";
import type { StaffSession } from "../session";

export type AddPersonField = "username" | "firstName" | "lastName" | "email" | "role";

/** What the "Add a person" form shows after a submission. Every text is already resolved from the catalog. */
export type AddPersonState =
  | { status: "idle" }
  | { status: "refused"; message: string; field?: AddPersonField; values: Partial<Record<AddPersonField, string>> }
  | { status: "created"; heading: string; username: string; password: string; line: string };

export interface AddPersonDeps {
  session: () => Promise<StaffSession | null>;
  identity: () => Pick<AccountService, "addPerson" | "refuseUnauthenticated">;
}

const PERMISSION = "accounts.create";
const ROUTE = "/staff/people";

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/**
 * The "Add a person" server action's work: resolves the session (refused as unauthenticated
 * without one), lets the identity module decide, and turns its answer into catalog text. The
 * identity module audits every outcome; nothing is sent to the new person.
 */
export async function addPersonFromForm(deps: AddPersonDeps, form: FormData): Promise<AddPersonState> {
  const values = {
    username: text(form, "username"),
    firstName: text(form, "firstName"),
    lastName: text(form, "lastName"),
    email: text(form, "email"),
    role: text(form, "role"),
  };
  const session = await deps.session();
  if (!session) {
    try {
      await deps.identity().refuseUnauthenticated(PERMISSION, ROUTE);
    } catch {
      // The identity module is not configured in this environment: the action stays refused.
    }
    return { status: "refused", message: englishText(REFUSAL_MESSAGE_KEYS.unauthenticated), values };
  }
  const result = await deps.identity().addPerson(session.staffId, values);
  if (!result.ok) {
    return { status: "refused", message: englishText(REFUSAL_MESSAGE_KEYS[result.error]), field: REFUSAL_FIELDS[result.error], values };
  }
  const name = `${values.firstName.trim()} ${values.lastName.trim()}`;
  return {
    status: "created",
    heading: englishText("staff.people.created", { name }),
    username: englishText("staff.people.createdUsername", { username: result.value.username }),
    password: englishText("staff.people.createdPassword", { password: result.value.startingPassword }),
    line: englishText("staff.people.createdLine"),
  };
}
