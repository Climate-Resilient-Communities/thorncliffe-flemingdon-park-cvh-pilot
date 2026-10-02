"use server";

import { identity } from "../identity";
import { currentStaffSession } from "../session";
import { addPersonFromForm, type AddPersonState } from "./addPerson";

/** "Add a person" (S01.05). Called directly or from the form; the session is resolved on the server either way. */
export async function addPersonAction(_previous: AddPersonState, form: FormData): Promise<AddPersonState> {
  return addPersonFromForm({ session: currentStaffSession, identity }, form);
}
