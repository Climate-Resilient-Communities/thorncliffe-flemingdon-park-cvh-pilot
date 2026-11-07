"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { RESIDENT_SPACES_TAG } from "@/contracts/openSpaces";
import { changeSpace, isSpaceStatus, withStatus, type SpaceChangeInput, type SpaceChangeResult, type SpaceState } from "@/modules/partners";
import { getDb } from "@/platform/db";
import { englishText } from "@/i18n/text";
import { staffAction, type ActionRefusal } from "../guard";
import type { StaffSession } from "../session";
import { PARTNER_PAGES, backTo, withNotice } from "./view";
import { pw } from "./words";

// A space's change is the policy action `space.update` (a Coordinator and an Admin, 2026-11-07): the guard refuses any other role before the
// action's own code, whatever the screen showed. Partner staff have no role of their own yet, so the person is a Hub account and the space is
// "confirmed by" that person, "the Hub". Each form names the page it came from (one of the area's own pages, checked by backTo) and the change
// goes back there with a notice in the query, so the forms work without scripts. A change reaches residents at once: the resident list of
// spaces (GET /api/spaces) is revalidated after it commits.
const SPEC = { route: "/staff/partners", access: "hub", action: "space.update" } as const;

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

const actorOf = (session: StaffSession) => ({ staffId: session.staffId, label: pw("board.byHub", { name: `${session.firstName} ${session.lastName}` }) });

/** After the use case: revalidate what shows the space, then go back to the page with what happened. `redirect` throws, so this never returns. */
function finish(form: FormData, spaceId: string, result: SpaceChangeResult): never {
  const back = backTo(field(form, "back"));
  if (result.ok) {
    revalidateTag(RESIDENT_SPACES_TAG, { expire: 0 });
    revalidatePath(PARTNER_PAGES.space, "layout");
    redirect(withNotice(back, spaceId, { done: "saved" }));
  }
  redirect(withNotice(back, spaceId, { error: result.error }));
}

/**
 * What a form's action answers when it does not go back to its page: the guard's refusal of someone still at a setup gate (the staff guard's
 * convention, test/staff-guard.test.ts). The forms bind it as their first argument (`action.bind(null, IDLE)`), so they post as plain forms.
 */
export type SpaceFormState = { status: "idle" } | { status: "refused"; message: string };

/**
 * A refusal by the guard: someone at a setup gate is answered in the state (they never reach these pages); a role the policy refuses (a
 * Director, an Ambassador) goes back to the page with "Only a Coordinator or an Admin can change a space", nothing changed.
 */
function refused(error: ActionRefusal, _previous: SpaceFormState, form: FormData): SpaceFormState {
  if (error === "setup_incomplete") return { status: "refused", message: englishText("staff.setup.incomplete") };
  redirect(withNotice(backTo(field(form, "back")), field(form, "spaceId"), { error: "forbidden" }));
}

/** P-01's "Open this space" and P-06's "Save and confirm": the status, purpose and capacities as the form sent them. */
export const changeSpaceAction = staffAction(
  SPEC,
  async (session, _previous: SpaceFormState, form: FormData): Promise<SpaceFormState> => {
    const spaceId = field(form, "spaceId");
    const input: SpaceChangeInput = { status: field(form, "status"), purpose: field(form, "purpose"), capacityMax: field(form, "capacityMax"), capacityNow: field(form, "capacityNow") };
    finish(form, spaceId, await changeSpace(getDb(), actorOf(session), spaceId, input));
  },
  refused,
);

/**
 * P-07's Open / Full / Closed and "Still correct" (`status` = `confirm`): the button names only the status, or nothing, and the rest of the space
 * is kept as it is under the lock, so a page loaded earlier never puts back a purpose or count someone has since changed.
 */
export const setSpaceStatusAction = staffAction(
  SPEC,
  async (session, _previous: SpaceFormState, form: FormData): Promise<SpaceFormState> => {
    const spaceId = field(form, "spaceId");
    const status = field(form, "status");
    // An unknown status is passed on as it came, and the space's rule refuses it (status_unknown), audited like any refusal.
    const input = (current: SpaceState): SpaceChangeInput => withStatus(current, status === "confirm" ? current.status : isSpaceStatus(status) ? status : (status as SpaceState["status"]));
    finish(form, spaceId, await changeSpace(getDb(), actorOf(session), spaceId, input));
  },
  refused,
);
