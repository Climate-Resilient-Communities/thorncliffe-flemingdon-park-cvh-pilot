import { englishText } from "@/i18n/text";
import { REFUSAL_MESSAGE_KEYS, type AddPersonView } from "@/modules/identity";
import { AddPersonForm, type AddPersonLabels } from "./AddPersonForm";

const LABEL_KEYS = ["username", "usernameHint", "firstName", "lastName", "nameHint", "email", "emailHint", "role", "submit", "addAnother"] as const;

/** The form's labels from the catalog, resolved on the server so the catalog never reaches the browser. */
export function addPersonLabels(): AddPersonLabels {
  return Object.fromEntries(LABEL_KEYS.map((key) => [key, englishText(`staff.people.${key}`)])) as unknown as AddPersonLabels;
}

/** The screen's body for a resolved view: the form, or why this person may not add anyone. */
export function AddPersonBody({ view }: { view: AddPersonView }) {
  if (!view.allowed) {
    return <p role="alert" className="hub-error">{englishText(REFUSAL_MESSAGE_KEYS[view.refusal])}</p>;
  }
  return (
    <AddPersonForm
      labels={addPersonLabels()}
      roles={view.roles.map((role) => ({ value: role, label: englishText(`staff.roles.${role}`) }))}
      note={view.bootstrap === "in_progress" ? englishText("staff.bootstrap.secondAdminOnly") : undefined}
    />
  );
}
