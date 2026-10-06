// The round types on the coverage page (S08.06, E08 "Round types"): which types of disruption start a check-in round, as every role that sees
// coverage reads them, and the form an Admin changes them with. The view model has every text already resolved from the English catalog; the
// control turns the form into places' use case (`roundTypes().set`), whose refusals it words. The guard has already refused anyone but an
// Admin at aal2 (policy action `checkins.round_types`).
//
// The residents' texts about check-ins (R33.what, groups.checkin.line, R24.checkin, A04.noRound, in every language) name heat warnings and
// power outages. The form says so beside the boxes, and a save that leaves Heat or Power unticked needs the confirmation box ticked too: the
// control refuses it otherwise, before the use case is asked (docs/config.md, "Changing which types start a round", says how the texts are then changed).
import { englishText } from "@/i18n/text";
import type { RoundTypeChoice, RoundTypesRefusal, RoundTypesService } from "@/modules/places";
import { typeName } from "../../alerts/typeNames";
import type { StaffSession } from "../../session";

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.coverage.rounds.${key}`, values);

/** The round types the residents' check-in texts name: unticking one of them needs the confirmation (`CONFIRM_FIELD`). */
export const RESIDENT_NAMED_ROUND_TYPES: readonly string[] = ["heat", "power"];
/** The confirmation box's field: "yes" when ticked. */
export const CONFIRM_FIELD = "confirmResidentTexts";

export interface RoundTypesFormView {
  legend: string;
  hint: string;
  /** That the residents' texts name heat and power, and what unticking one does to them. */
  residentTexts: string;
  /** The confirmation box's label. */
  confirm: string;
  save: string;
  saving: string;
  /** Every type of disruption by its name, ticked when it starts a round now. */
  choices: { id: string; label: string; checked: boolean }[];
}

export interface RoundTypesView {
  heading: string;
  lead: string;
  /** "Types that start a round now: Heat, Power.", or that none does. */
  current: string;
  /** Only for someone who may change them (an Admin). */
  form?: RoundTypesFormView;
  /** Everyone else (a Coordinator, a Director) is told who can. */
  readOnly?: string;
}

const namesOf = (ids: readonly string[]) => ids.map(typeName).join(", ");

export function roundTypesView(choices: readonly RoundTypeChoice[], options: { editable: boolean }): RoundTypesView {
  const round = choices.filter((choice) => choice.round).map((choice) => choice.id);
  return {
    heading: t("heading"),
    lead: t("lead"),
    current: round.length > 0 ? t("current", { types: namesOf(round) }) : t("none"),
    ...(options.editable
      ? { form: { legend: t("legend"), hint: t("hint"), residentTexts: t("residentTexts"), confirm: t("confirm"), save: t("save"), saving: t("saving"), choices: choices.map((choice) => ({ id: choice.id, label: typeName(choice.id), checked: choice.round })) } }
      : { readOnly: t("readOnly") }),
  };
}

/** What a press answers, already in words: `done` is the line to read; `refused` one message in the Hub's error style (nothing was changed). */
export type RoundTypesAnswer = { status: "done"; line: string } | { status: "refused"; message: string };

/** What the form shows: nothing yet, or the last answer with the time it was given (a new press with the same answer is a new state). */
export type RoundTypesState = { status: "idle" } | (RoundTypesAnswer & { at: number });

export interface RoundTypesDeps {
  roundTypes: () => Pick<RoundTypesService, "set">;
  /** Operational error log (structured, no personal data): the error's name only. */
  logError: (event: string, fields: Record<string, string>) => void;
}

const MESSAGE_KEYS: Record<RoundTypesRefusal, string> = { unknown_type: "errors.unknownType", no_change: "errors.noChange" };

/**
 * "Save round types" for the Admin the guard let through: the ticked types (`type`, one per tick; none ticked is none) become the round types, as the
 * Admin of the session. With Heat or Power unticked, only when the confirmation box is ticked as well (else refused, nothing changed). A failure
 * changes nothing and says so in as many words.
 */
export async function setRoundTypesFromForm(deps: RoundTypesDeps, session: Pick<StaffSession, "staffId">, form: FormData): Promise<RoundTypesAnswer> {
  const ticked = form.getAll("type");
  if (RESIDENT_NAMED_ROUND_TYPES.some((type) => !ticked.includes(type)) && form.get(CONFIRM_FIELD) !== "yes") return { status: "refused", message: t("errors.confirmNeeded") };
  try {
    const result = await deps.roundTypes().set(session.staffId, ticked);
    if (!result.ok) return { status: "refused", message: t(MESSAGE_KEYS[result.error]) };
    const types = result.value.roundTypes;
    return { status: "done", line: types.length > 0 ? t("done", { types: namesOf(types) }) : t("doneNone") };
  } catch (error) {
    deps.logError("round_types.set_failed", { error: error instanceof Error ? error.name : "NonError" });
    return { status: "refused", message: t("errors.failed") };
  }
}
