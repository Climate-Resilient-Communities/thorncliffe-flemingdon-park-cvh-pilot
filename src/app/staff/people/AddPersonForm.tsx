"use client";

import { useActionState, type ReactNode } from "react";
import { Stack } from "@/ui";
import { addPersonAction } from "./actions";
import type { AddPersonField, AddPersonState } from "./addPerson";

export interface AddPersonLabels {
  username: string;
  usernameHint: string;
  firstName: string;
  lastName: string;
  nameHint: string;
  email: string;
  emailHint: string;
  role: string;
  submit: string;
  addAnother: string;
}

export interface AddPersonFormProps {
  labels: AddPersonLabels;
  roles: { value: string; label: string }[];
  /** Shown above the form, for example during bootstrap. */
  note?: string;
  /** Test seam: the state to start from. */
  initialState?: AddPersonState;
}

const ERROR_ID = "add-person-error";

function Field(props: {
  name: AddPersonField;
  label: string;
  hint?: string;
  state: AddPersonState;
  children: (attributes: { id: string; name: string; "aria-describedby"?: string; "aria-invalid"?: true; defaultValue?: string }) => ReactNode;
}) {
  const { name, label, hint, state } = props;
  const invalid = state.status === "refused" && state.field === name;
  const described = [hint ? `${name}-hint` : null, invalid ? ERROR_ID : null].filter(Boolean).join(" ");
  return (
    <Stack gap="label">
      <label htmlFor={name}>{label}</label>
      {hint && <p id={`${name}-hint`}>{hint}</p>}
      {props.children({
        id: name,
        name,
        "aria-describedby": described || undefined,
        "aria-invalid": invalid || undefined,
        defaultValue: state.status === "refused" ? state.values[name] : undefined,
      })}
    </Stack>
  );
}

/** "Add a person" (S01.05): an Admin enters the person's details; the result shows what to hand over in person. */
export function AddPersonForm({ labels, roles, note, initialState = { status: "idle" } }: AddPersonFormProps) {
  const [state, formAction, pending] = useActionState(addPersonAction, initialState);

  if (state.status === "created") {
    return (
      <section aria-live="polite">
        <Stack gap="related">
          <h2>{state.heading}</h2>
          <p>{state.username}</p>
          <p>{state.password}</p>
          <p>{state.line}</p>
          {/* A full page load on purpose: it discards the created-state (and its one-time password) from memory. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="tap" href="/staff/people">
            {labels.addAnother}
          </a>
        </Stack>
      </section>
    );
  }

  return (
    // A new key after each refusal re-renders the fields with the values just entered.
    <form className="hub-form" action={formAction} key={state.status === "refused" ? JSON.stringify(state) : "new"}>
      <Stack gap="stack">
        {note && <p>{note}</p>}
        {state.status === "refused" && (
          <p id={ERROR_ID} role="alert" className="hub-error">
            {state.message}
          </p>
        )}
        <Field name="username" label={labels.username} hint={labels.usernameHint} state={state}>
          {(attributes) => <input className="hub-input" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} required {...attributes} />}
        </Field>
        <Field name="firstName" label={labels.firstName} hint={labels.nameHint} state={state}>
          {(attributes) => <input className="hub-input" type="text" autoComplete="off" required {...attributes} />}
        </Field>
        <Field name="lastName" label={labels.lastName} state={state}>
          {(attributes) => <input className="hub-input" type="text" autoComplete="off" required {...attributes} />}
        </Field>
        <Field name="email" label={labels.email} hint={labels.emailHint} state={state}>
          {(attributes) => <input className="hub-input" type="email" autoComplete="off" required {...attributes} />}
        </Field>
        <Field name="role" label={labels.role} state={state}>
          {(attributes) => (
            <select className="hub-input" required {...attributes} defaultValue={attributes.defaultValue ?? roles[0]?.value}>
              {roles.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <button className="hub-button hub-button--primary" type="submit" disabled={pending}>
          {labels.submit}
        </button>
      </Stack>
    </form>
  );
}
