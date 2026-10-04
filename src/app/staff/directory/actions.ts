"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { englishText } from "@/i18n/text";
import { DIRECTORY_RELEASE_TAG } from "../../releaseFileCache";
import { staffAction, type ActionRefusal } from "../guard";
import { directoryDb, directoryPublishDeps } from "../directory";
import { publishFromForm, type PublishState } from "./publishRelease";

// "Publish directory" is the policy action `guide.publish` (AD-4: Admins only), which is also privileged
// (S01.10): the guard refuses any other role, then a session below aal2, before the action's own code,
// whatever the screen showed. The action takes no listing text and no provider: it publishes what the
// providers screen has published (AD-11).
const ROUTE = "/staff/directory";
const deps = { db: directoryDb, publish: directoryPublishDeps };

// This action declares no `context`, so a `bad_request` cannot arise; it reads as forbidden.
const REFUSAL_KEYS: Record<ActionRefusal, string> = {
  forbidden: "staff.directory.errors.forbidden",
  bad_request: "staff.directory.errors.forbidden",
  setup_incomplete: "staff.setup.incomplete",
  aal2_required: "staff.directory.errors.aal2Required",
};

const refused = (error: ActionRefusal): PublishState => ({ status: "refused", message: englishText(REFUSAL_KEYS[error]), problems: null });

/** "Publish directory". Called directly or from the form; the guard resolves the session on the server either way. */
export const publishDirectoryAction = staffAction(
  { route: ROUTE, access: "hub", action: "guide.publish" },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the form action's (previous state, form) pair; the button takes no input
  async (session, _previous: PublishState, _form: FormData): Promise<PublishState> => {
    const state = await publishFromForm(deps, session);
    // A new release is current: the shared cache of the search's release files is expired too (its entries are named by release and hash, so this is belt and braces).
    if (state.status === "done") revalidateTag(DIRECTORY_RELEASE_TAG, { expire: 0 });
    // The page shows the current release and the last failure: read them again.
    revalidatePath(ROUTE);
    return state;
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- as above
  (error, _previous: PublishState, _form: FormData): PublishState => refused(error),
);
