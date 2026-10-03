// What the composer's form (O-12, O-02) sends, as the draft's content (S04.05): the English text, the valid-until in Toronto time and, for
// the full alert composer, the types and where things stand. Whatever the form does not carry keeps the draft's value: the acknowledgement
// composer never changes the types, and neither composer changes who it is for (the place and group pages do). The audience's own topics
// follow the types, so a change of type keeps the one Audience in its stored form. The words of a problem come from the English catalog.
import type { Audience } from "@/contracts/audience";
import { PHASES, UNTIL_RESOLVED_MS, type EntryContent, type Phase } from "@/modules/alerting";
import { foldQuestionValues, parseTimeFields, timeFieldsOf } from "../timeField";
import { englishText } from "@/i18n/text";

/** How the person chose the valid-until: "until resolved" (24 elapsed hours from now) or a date and a time (Toronto time). */
export type ValidMode = "resolved" | "at";

/** What the person is asked or told about the time they entered. */
export type TimeProblem =
  | { kind: "message"; message: string }
  /** The valid-until is in the repeated hour of the clock change: the person says before or after. */
  | { kind: "ask"; question: string; before: string; after: string };

export type ContentFromForm = { ok: true; content: EntryContent } | { ok: false; problem: TimeProblem };

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.time.${key}`, values);

/** English text of a form as the draft keeps it: line ends as `\n` (a browser sends `\r\n`), and nothing before or after it. */
export const normaliseText = (value: string): string => value.replace(/\r\n?/g, "\n").trim();

/** The types ticked, each once; none sent (the acknowledgement composer) means the draft's own. */
function typesOf(form: FormData, current: readonly string[]): string[] {
  const sent = form.getAll("type").filter((value): value is string => typeof value === "string" && value !== "");
  return sent.length === 0 && !form.has("types-sent") ? [...current] : [...new Set(sent)];
}

/** The draft's content with what the form changed: the text, the types, where things stand and the valid-until. */
export function contentFromForm(form: FormData, current: EntryContent, now: Date): ContentFromForm {
  const text = form.get("text");
  const phase = form.get("phase");
  const types = typesOf(form, current.types).sort();
  const audience: Audience = { ...current.audience, types };
  const mode: ValidMode = form.get("valid-mode") === "at" ? "at" : "resolved";
  let validUntil: Date;
  if (mode === "resolved") {
    validUntil = new Date(now.getTime() + UNTIL_RESOLVED_MS);
  } else {
    const parsed = parseTimeFields(timeFieldsOf(form, "valid"));
    if (!parsed.ok) {
      if (parsed.problem === "ambiguous") {
        const values = foldQuestionValues(parsed);
        return { ok: false, problem: { kind: "ask", question: t("foldQuestion", { time: values.time, date: values.date }), before: t("foldBefore", { time: values.before }), after: t("foldAfter", { time: values.after }) } };
      }
      return { ok: false, problem: { kind: "message", message: parsed.problem === "nonexistent" ? t("nonexistent") : t("invalid") } };
    }
    validUntil = parsed.instant;
  }
  return {
    ok: true,
    content: {
      text: typeof text === "string" ? normaliseText(text) : current.text,
      types,
      audience,
      phase: (PHASES as readonly string[]).includes(String(phase)) ? (phase as Phase) : current.phase,
      validUntil,
      validUntilMode: mode,
    },
  };
}
