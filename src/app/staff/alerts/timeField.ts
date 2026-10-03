// A date and a time that staff type, as Toronto wall-clock time (spine: Consistency Conventions, Time), read from a form and turned into an
// instant by platform/clock#fromToronto (S04.05): the time of the first report (O-11) and the valid-until (O-12, O-02). A time that does
// not exist (the hour the clocks skip going forward) is refused with its reason; a time that occurs twice (the hour the clocks repeat
// going back) asks whether the person means before or after the clock change, and is not read until they answer. Pure.
import { formatTorontoDate, formatTorontoTime, fromToronto, parseLocalDateTime, torontoFields } from "@/platform/clock";

/** The three fields of one time input in a form: `<prefix>-date`, `<prefix>-time` and, once asked, `<prefix>-fold`. */
export interface TimeFields {
  date: string;
  time: string;
  /** "before" or "after" the clock change, once the person has been asked; "" otherwise. */
  fold: "" | "before" | "after";
}

export type TimeParse =
  | { ok: true; instant: Date }
  /** Not a date and a time. */
  | { ok: false; problem: "invalid" }
  /** The time does not exist in Toronto (the clocks skip it). */
  | { ok: false; problem: "nonexistent" }
  /** The time occurs twice: the person chooses `before` or `after`. */
  | { ok: false; problem: "ambiguous"; before: Date; after: Date };

/** What a form sent for one time input. */
export function timeFieldsOf(form: FormData, prefix: string): TimeFields {
  const text = (name: string) => {
    const value = form.get(`${prefix}-${name}`);
    return typeof value === "string" ? value : "";
  };
  const fold = text("fold");
  return { date: text("date"), time: text("time"), fold: fold === "before" || fold === "after" ? fold : "" };
}

/** The instant a date, a time and an answer to the clock-change question mean. */
export function parseTimeFields(fields: TimeFields): TimeParse {
  const local = parseLocalDateTime(fields.date, fields.time);
  if (local === null) return { ok: false, problem: "invalid" };
  const converted = fromToronto(local, fields.fold === "" ? undefined : fields.fold);
  if (converted.ok) return { ok: true, instant: converted.instant };
  if (converted.reason === "ambiguous") return { ok: false, problem: "ambiguous", before: converted.before, after: converted.after };
  return { ok: false, problem: converted.reason === "nonexistent" ? "nonexistent" : "invalid" };
}

/** The fields to show for an instant: its Toronto date and time, with no answer to the clock-change question. */
export function fieldsOfInstant(instant: Date): TimeFields {
  return { ...torontoFields(instant), fold: "" };
}

/** The question a repeated time asks, as the strings fill it: the time (with no zone), the date, and the two readings with their zones. */
export function foldQuestionValues(parse: Extract<TimeParse, { problem: "ambiguous" }>): { time: string; date: string; before: string; after: string } {
  const withoutZone = (instant: Date) => formatTorontoTime(instant).replace(/\s*[A-Z]{3,4}$/, "");
  return { time: withoutZone(parse.before), date: formatTorontoDate(parse.before), before: formatTorontoTime(parse.before), after: formatTorontoTime(parse.after) };
}
