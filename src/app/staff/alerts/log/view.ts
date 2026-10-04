// What "Log a disruption" (O-11) shows (S04.05): the view model, with every text already resolved from the English catalog, so that the
// component that draws it knows none of it and the layout tests can put the longest translated labels in every place.
import { englishText } from "@/i18n/text";
import type { BuildingFloorPlan } from "@/modules/places";
import { placeFieldsOf, type PlaceFieldsView } from "../audience/view";
import { fieldsOfInstant, type TimeFields } from "../timeField";
import { typeName } from "../typeNames";
import { exerciseWords, type ExerciseWords } from "../../ExerciseMarker";
import { BUILDING_TYPES, NEIGHBOURHOOD_ONLY_TYPES as NEIGHBOURHOOD_TYPES } from "@/contracts/alertContent";

export type Text = (key: string, values?: Record<string, string | number>) => string;

/** The words of this screen: `staff.log.<key>` of the catalog. */
export const catalogText: Text = (key, values) => englishText(`staff.log.${key}`, values);
const timeText: Text = (key, values) => englishText(`staff.time.${key}`, values);

export interface TypeChoiceView {
  id: string;
  label: string;
  checked: boolean;
}

export interface LogScreen {
  /** What the first entry is: the acknowledgement (O-12) or the full alert (O-02). */
  kind: "ack" | "update";
  title: string;
  lead: string;
  benchmark: string;
  types: {
    title: string;
    hint: string;
    building: { label: string; items: TypeChoiceView[] };
    neighbourhood: { label: string; hint: string; items: TypeChoiceView[] };
  };
  place: { title: string; hint: string; fields: PlaceFieldsView };
  /** "Start a drill" (S06.05): the exercise marker, shown above the form; null for a real disruption. */
  exercise: ExerciseWords | null;
  when: { title: string; hint: string; dateLabel: string; timeLabel: string; fields: TimeFields; foldLegend: string };
  submit: string;
}

export interface LogOptions {
  kind: "ack" | "update";
  /** "Start a drill" (S06.05): the words are the drill's, and the screen carries the exercise marker. */
  drill?: boolean;
  text?: Text;
  /** Fields typed before a refusal, so the screen keeps them. */
  typed?: { types?: readonly string[]; when?: TimeFields };
}

/** The form for logging a disruption now: nothing chosen, and the time of the first report set to the moment the page was made. */
export function logScreen(plans: readonly BuildingFloorPlan[], now: Date, options: LogOptions): LogScreen {
  const t = options.text ?? catalogText;
  const ticked = new Set(options.typed?.types ?? []);
  const items = (ids: readonly string[]): TypeChoiceView[] => ids.map((id) => ({ id, label: typeName(id), checked: ticked.has(id) }));
  const drill = options.drill === true;
  return {
    kind: options.kind,
    title: drill ? t("drillTitle") : options.kind === "ack" ? t("title") : t("alertTitle"),
    lead: drill ? t("drillLead") : options.kind === "ack" ? t("lead") : t("alertLead"),
    benchmark: drill ? t("drillBenchmark") : t("benchmark"),
    exercise: drill ? exerciseWords() : null,
    types: {
      title: t("typesTitle"),
      hint: t("typesHint"),
      building: { label: t("inBuilding"), items: items(BUILDING_TYPES) },
      neighbourhood: { label: t("inNbhd"), hint: t("nbhdOnlyHint"), items: items(NEIGHBOURHOOD_TYPES) },
    },
    place: { title: t("placeTitle"), hint: t("placeHint"), fields: placeFieldsOf(plans, null) },
    when: { title: t("whenTitle"), hint: t("whenHint"), dateLabel: timeText("dateLabel"), timeLabel: timeText("timeLabel"), fields: options.typed?.when ?? fieldsOfInstant(now), foldLegend: timeText("foldLegend") },
    submit: drill ? t("drillSubmit") : options.kind === "ack" ? t("submit") : t("submitAlert"),
  };
}

export const forbiddenMessage = (t: Text = catalogText) => t("forbidden");
