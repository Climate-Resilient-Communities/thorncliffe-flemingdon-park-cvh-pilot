import { SIGNUP_CONTRACT_VERSION, checkSignupRequest } from "@/contracts/signup";
import type { Signup } from "@/modules/subscriptions";
import type { StaffSession } from "../session";
import { refusalMessage } from "./view";

/**
 * What a press of "Send the confirmation text" answers. `done` is the same for a new number, one already pending and one already subscribed
 * (AD-22): the staff member learns no more than the resident's web form would. A refusal is one message in the Hub's error style; nothing was
 * stored or sent. No answer holds the number.
 */
export type SignupAnswer = { status: "done" } | { status: "refused"; message: string };

/** What the form shows: nothing yet, or the last answer with the time it was given (a new answer re-draws the form). */
export type SignupState = { status: "idle" } | (SignupAnswer & { at: number });

export interface ControlDeps {
  signup: () => Signup;
  /** Starts the dispatcher after the answer, so the confirmation goes out within seconds. */
  afterAccepted: () => void;
  /** Operational error log (structured, no personal data): the error's name only. */
  logError: (event: string, fields: Record<string, string>) => void;
}

const nameOfError = (error: unknown) => (error instanceof Error ? error.name : "NonError");

/** A field's text, or null when it is missing or not text. */
function text(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === "string" ? value : null;
}

/**
 * The form as the sign-up contract's request body (src/contracts/signup.ts), so a staff-assisted sign-up is checked by exactly the rules of
 * the resident's web form: a Canadian number (digits in any script), a neighbourhood, the terms agreed and the age statement confirmed, the
 * terms version shown. The staff member ticks the two statements for the resident (S07.03): the resident has heard the terms in their own
 * language and agrees, and confirms the age statement shown in that language. A field that is not text makes the body unreadable.
 */
export function bodyFromForm(form: FormData): unknown {
  const phone = text(form, "phone");
  const lang = text(form, "lang");
  const consentVersion = text(form, "consent_version");
  if (phone === null || lang === null || consentVersion === null) return null;
  const building = text(form, "building") ?? "";
  const floor = text(form, "floor") ?? "";
  const groups = form.getAll("groups");
  if (groups.some((group) => typeof group !== "string")) return null;
  return {
    v: SIGNUP_CONTRACT_VERSION,
    phone,
    lang,
    neighbourhood: text(form, "neighbourhood") || null,
    places: building === "" ? [] : [{ rsn: building, floors: floor === "" ? [] : [floor] }],
    groups,
    consent_version: consentVersion,
    terms_agreed: text(form, "terms_agreed") === "yes",
    age_confirmed: text(form, "age_confirmed") === "yes",
  };
}

/**
 * "Send the confirmation text" for the staff member the guard let through (`signup.assist`): the form is checked by the contract and handed
 * to the sign-up's `assist`, which counts it against this staff account (never the client's address), writes the pending sign-up with
 * `started_by = staff` and queues the one confirmation text, and audits `signup.assisted` with the staff id and the outcome. The number is
 * read here and handed on; it is not echoed back, logged or put in an error.
 */
export async function signupFromForm(deps: ControlDeps, session: Pick<StaffSession, "staffId">, form: FormData): Promise<SignupAnswer> {
  try {
    const outcome = await deps.signup().assist(checkSignupRequest(bodyFromForm(form)), session.staffId);
    if (outcome.kind === "rate_limited") return { status: "refused", message: refusalMessage("rate_limited") };
    if (outcome.kind === "refused") return { status: "refused", message: refusalMessage(outcome.code) };
    deps.afterAccepted();
    return { status: "done" };
  } catch (error) {
    deps.logError("signup.assisted_failed", { error: nameOfError(error) });
    return { status: "refused", message: refusalMessage("failed") };
  }
}
