// The suggested English acknowledgement (O-12, S04.05): the text a logged disruption's draft starts with, built from its types and its
// place, which the author may edit. The wording is the prototype's own (strings `O12.acks.<type>`, with `{on}` and `{in}` where the place
// goes); a disruption of several types says so in one sentence. It is a suggestion, not a template that is checked or translated in
// advance: the author's text, whatever it ends up as, is translated and checked at submit. Pure.
import type { Audience } from "@/contracts/audience";
import { ALERT_TEXT_MAX } from "@/modules/alerting";
import { englishText } from "@/i18n/text";
import type { BuildingFloorPlan } from "@/modules/places";

type Text = (key: string, values?: Record<string, string | number>) => string;

/** "A", "A and B", "A, B and C". */
function joinWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const lowerFirst = (text: string) => (text === "" ? text : text[0].toLowerCase() + text.slice(1));

/** Where it is, as words that follow the subject of the sentence: " at 4 Milepost Pl, floors 3 to 5", " in Thorncliffe Park". */
function placePhrase(audience: Audience, plans: readonly BuildingFloorPlan[], t: Text, brief: boolean): string {
  if (audience.scope === "neighbourhood") {
    const names = audience.neighbourhood_ids.map((id) => plans.find((plan) => plan.neighbourhoodId === id)?.neighbourhoodName ?? id);
    return t("suggest.inNbhd", { place: joinWords(names) });
  }
  if (brief) return t("suggest.at", { place: audience.buildings.length === 1 ? (plans.find((plan) => plan.rsn === audience.buildings[0].rsn)?.address ?? audience.buildings[0].rsn) : t("suggest.manyBuildings", { n: audience.buildings.length }) });
  const pieces = audience.buildings.map((chosen) => {
    const plan = plans.find((candidate) => candidate.rsn === chosen.rsn);
    const address = plan?.address ?? chosen.rsn;
    if (chosen.floors === null || plan === undefined) return address;
    const labels = plan.floors.filter((floor) => chosen.floors!.includes(floor.id)).map((floor) => floor.label);
    if (labels.length === 0) return address;
    return `${address}${t(labels.length === 1 ? "suggest.floor" : "suggest.floors", { labels: joinWords(labels) })}`;
  });
  return t("suggest.at", { place: joinWords(pieces) });
}

/** The text for these types in this place; never longer than the alert text limit (a long list of buildings is summarised). */
export function suggestedAck(types: readonly string[], audience: Audience, plans: readonly BuildingFloorPlan[], t: Text = (key, values) => englishText(`staff.compose.${key}`, values)): string {
  const prototype: Text = (key, values) => englishText(key, values);
  const build = (brief: boolean) => {
    const where = placePhrase(audience, plans, t, brief);
    if (types.length === 1) return prototype(`O12.acks.${types[0]}.text`, { on: where, in: where });
    const list = joinWords(types.map((type) => lowerFirst(prototype(`O12.acks.${type}.headline`))));
    return t("suggest.several", { on: where, list });
  };
  const full = build(false);
  return full.length <= ALERT_TEXT_MAX ? full : build(true);
}
