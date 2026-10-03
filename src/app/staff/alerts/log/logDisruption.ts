// "Log a disruption" (O-11, S04.05): what the form sends, as the use case takes it, and what the person is told. A disruption has one or
// more types, a place (the same picker as the place page, O-03) and the time the first report reached the Hub, typed in Toronto time.
// The use case makes the thread and its first draft (a suggested acknowledgement text for the type and the place, which the author edits
// next); this turns the form into its input and its refusals into words. The words come from the English catalog.
import { BUILDING_TYPES, NEIGHBOURHOOD_ONLY_TYPES } from "@/contracts/alertContent";
import { AUTHORED_KINDS, type AlertLifecycle, type AlertRefusal } from "@/modules/alerting";
import { englishText } from "@/i18n/text";
import type { BuildingFloorPlan } from "@/modules/places";
import type { StaffSession } from "../../session";
import { placeChoiceFromForm, refusalMessage } from "../audience/editAudience";
import { foldQuestionValues, parseTimeFields, timeFieldsOf } from "../timeField";
import { ACK_PAGE, COMPOSE_PAGE } from "../pages";
import { suggestedAck } from "../suggestAck";

// The disruption types O-11 lists: those a building can have, then the neighbourhood-wide ones (src/contracts/alertContent.ts).
export { BUILDING_TYPES, NEIGHBOURHOOD_ONLY_TYPES as NEIGHBOURHOOD_TYPES };


/** What the form shows after a submission. A logged disruption sends the person on (`location`). */
export type LogState =
  | { status: "idle" }
  | { status: "refused"; message: string }
  /** The time of the first report is in the repeated hour of the clock change: the person says before or after. */
  | { status: "ask"; question: string; before: string; after: string }
  | { status: "logged"; location: string };

export interface LogDeps {
  alerting: () => Pick<AlertLifecycle, "logDisruption">;
  /** The buildings and their floors, for the suggested text. */
  plans: () => Promise<readonly BuildingFloorPlan[]>;
  now: () => Date;
}

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.log.${key}`, values);
const time = (key: string, values?: Record<string, string | number>) => englishText(`staff.time.${key}`, values);

const LOG_ERROR_KEYS: Partial<Record<AlertRefusal, string>> = {
  REPORTED_AT_INVALID: "futureTime",
  TYPES_EMPTY: "chooseType",
  TYPES_REPEATED: "typesRepeated",
  UNKNOWN_TYPE: "unknownType",
};

/** The message for a refusal of the use case: this screen's own wording for its three, the place picker's for the rest. */
export function logRefusalMessage(error: AlertRefusal): string {
  const own = LOG_ERROR_KEYS[error];
  return own ? t(`errors.${own}`) : refusalMessage(error);
}

const refused = (message: string): LogState => ({ status: "refused", message });

/** The types ticked: each id once, as sent. What the types are is the use case's to judge (an unknown one is UNKNOWN_TYPE). */
function typesOf(form: FormData): string[] {
  return [...new Set(form.getAll("type").filter((value): value is string => typeof value === "string" && value !== ""))];
}

/**
 * Logs the disruption the form describes. `kind` is what the first entry is: `ack` for the acknowledgement composer (O-12), `update`
 * for the full alert composer (O-02); the use case refuses any other. Nothing is made unless every part is right: the types, the
 * place and the time; a time in the repeated hour of the clock change asks which one is meant, and a time that does not exist is refused.
 */
export async function logDisruptionFromForm(deps: LogDeps, session: Pick<StaffSession, "staffId" | "aal">, form: FormData): Promise<LogState> {
  const kindField = form.get("kind");
  const kind = (AUTHORED_KINDS as readonly string[]).find((candidate) => candidate === kindField);
  if (kind !== "ack" && kind !== "update") return refused(t("errors.invalid"));
  const types = typesOf(form);
  if (types.length === 0) return refused(t("errors.chooseType"));
  const place = placeChoiceFromForm(form);
  if (!place.ok) return place.state.status === "refused" ? refused(place.state.message) : refused(t("errors.invalid"));
  const reported = parseTimeFields(timeFieldsOf(form, "reported"));
  if (!reported.ok) {
    if (reported.problem === "ambiguous") {
      const values = foldQuestionValues(reported);
      return { status: "ask", question: time("foldQuestion", { time: values.time, date: values.date }), before: time("foldBefore", { time: values.before }), after: time("foldAfter", { time: values.after }) };
    }
    return refused(reported.problem === "nonexistent" ? time("nonexistent") : time("invalid"));
  }
  const plans = await deps.plans();
  const result = await deps.alerting().logDisruption(
    { staffId: session.staffId, aal: session.aal },
    {
      kind,
      isDrill: false,
      reportedAt: reported.instant,
      types,
      place: place.choice,
      textFor: (audience) => suggestedAck(types, audience, plans),
    },
  );
  if (!result.ok) return refused(logRefusalMessage(result.error));
  const { thread, entry } = result.value;
  const page = kind === "ack" ? ACK_PAGE : COMPOSE_PAGE;
  return { status: "logged", location: `${page}?${new URLSearchParams({ alert: thread.id, entry: entry.id }).toString()}` };
}
