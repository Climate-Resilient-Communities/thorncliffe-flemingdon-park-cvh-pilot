"use server";

import { revalidatePath } from "next/cache";
import { englishText } from "@/i18n/text";
import { staffAction, type ActionRefusal } from "../guard";
import { directoryDb } from "../directory";
import { confirmFromForm, providerIdOf, publishFromForm, unpublishFromForm, type ProviderActionState } from "./changeProvider";

// Every provider change is the policy action `provider.manage` (AD-4: Admins only, "publish directory"),
// which is also privileged (S01.10): the guard refuses any other role, then a session below aal2,
// before the action's own code, whatever the screen showed. No action here takes listing text: a
// provider's text changes only through the catalogue scripts (AD-11).
const ROUTE = "/staff/providers";
const deps = { db: directoryDb };

// These actions declare no `context`, so a `bad_request` cannot arise; it reads as forbidden.
const REFUSAL_KEYS: Record<ActionRefusal, string> = {
  forbidden: "staff.providers.errors.forbidden",
  bad_request: "staff.providers.errors.forbidden",
  setup_incomplete: "staff.setup.incomplete",
  aal2_required: "staff.authenticator.required",
};

const refused = (error: ActionRefusal, _previous: ProviderActionState, form: FormData): ProviderActionState => ({
  status: "refused",
  providerId: providerIdOf(form),
  message: englishText(REFUSAL_KEYS[error]),
});

/** After a change, the list is read again so the row shows its new state. */
function changed(state: ProviderActionState): ProviderActionState {
  if (state.status === "done") revalidatePath(ROUTE);
  return state;
}

/** "Publish" on a provider row. Called directly or from the form; the guard resolves the session on the server either way. */
export const publishProviderAction = staffAction(
  { route: ROUTE, access: "hub", action: "provider.manage" },
  async (session, _previous: ProviderActionState, form: FormData): Promise<ProviderActionState> => changed(await publishFromForm(deps, session, form)),
  refused,
);

/** "Unpublish" on a provider row. */
export const unpublishProviderAction = staffAction(
  { route: ROUTE, access: "hub", action: "provider.manage" },
  async (session, _previous: ProviderActionState, form: FormData): Promise<ProviderActionState> => changed(await unpublishFromForm(deps, session, form)),
  refused,
);

/** "Save date" on a provider row: sets the last-confirmed date. */
export const confirmProviderAction = staffAction(
  { route: ROUTE, access: "hub", action: "provider.manage" },
  async (session, _previous: ProviderActionState, form: FormData): Promise<ProviderActionState> => changed(await confirmFromForm(deps, session, form)),
  refused,
);
