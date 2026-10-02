// What the resident building page shows (S02.08, FR-D4-P, NFR-N7): the view model for one building, with every
// text already taken from the language's catalog, so the page that draws it only lays it out. A plain module with no
// framework import, so a unit test can build it from a building and a translator.
import { isEnglishFallback } from "@/ui/text/resident-text";
import { formatDay, withDate, type Translate } from "../../../residentDates";
import { CONTACT_ROLE_LABEL_KEYS, displayPhone, telHref, type PublicBuilding } from "@/modules/places";

/**
 * How a fact is shown. "No" and "Not known" are different answers: the register says there is none, or it says
 * nothing. They differ in their words, in the mark beside them and in their style, never by colour alone.
 */
export type FactValue =
  | { kind: "yes" | "no" | "unknown"; text: string }
  | { kind: "number"; text: string }
  /** What the register wrote about the air conditioning: a translated word, or the register's own English one. */
  | { kind: "register"; text: string; english: boolean };

export interface FactRow {
  id: "storeys" | "elevators" | "emergencyPower" | "coolingRoom" | "airConditioning" | "barrierFree";
  label: string;
  value: FactValue;
}

export interface ContactView {
  /** "Provided by the Hub, last updated October 1, 2026"; null when no contact was entered. */
  provided: string | null;
  /** The role's translated label: "Superintendent", "Building management" or "Property office". */
  role: string | null;
  /** The number as people read it: (416) 555-0123. */
  phone: string | null;
  /** The number to put after `tel:`. */
  telHref: string | null;
  /** "Not known" when none was entered. */
  none: string;
  /** "Call" */
  call: string;
  /** True when `call` is English standing in for a missing translation: the button then reads as English, left to right. */
  callIsEnglish: boolean;
}

export interface BuildingPageView {
  rsn: string;
  address: string;
  neighbourhood: string;
  /** Set when the latest register no longer lists the building: the Hub is checking its details. */
  checking: string | null;
  registerTitle: string;
  registerLead: string;
  /** "Last updated October 1, 2026" */
  updated: string;
  facts: FactRow[];
  contactTitle: string;
  contact: ContactView;
}

const AIR_WORDS: Record<string, string> = { none: "airNone", "individual units": "airIndividual" };

export function buildingPageView(building: PublicBuilding, t: Translate, locale: string): BuildingPageView {
  const yesNo = (value: boolean | null): FactValue =>
    value === null ? { kind: "unknown", text: t("x09.unknown") } : value ? { kind: "yes", text: t("x09.yes") } : { kind: "no", text: t("x09.no") };
  const count = (value: number | null): FactValue => (value === null ? { kind: "unknown", text: t("x09.unknown") } : { kind: "number", text: String(value) });
  const air = (): FactValue => {
    if (building.airConditioning === null) return { kind: "unknown", text: t("x09.unknown") };
    const key = AIR_WORDS[building.airConditioning.trim().toLowerCase()];
    return key ? { kind: "register", text: t(`building.${key}`), english: false } : { kind: "register", text: building.airConditioning, english: true };
  };

  const contact = building.contact;
  return {
    rsn: building.rsn,
    address: building.address,
    neighbourhood: building.neighbourhoodName,
    checking: building.checkingDetails ? t("building.checking") : null,
    registerTitle: t("building.registerTitle"),
    registerLead: t("building.registerLead"),
    updated: withDate(t, "building.updated", building.factsUpdatedAt, locale),
    facts: [
      { id: "storeys", label: t("building.facts.storeys"), value: count(building.storeys) },
      { id: "elevators", label: t("building.facts.elevators"), value: count(building.elevators) },
      { id: "emergencyPower", label: t("building.facts.emergencyPower"), value: yesNo(building.emergencyPower) },
      { id: "coolingRoom", label: t("building.facts.coolingRoom"), value: yesNo(building.coolingRoom) },
      { id: "airConditioning", label: t("building.facts.airConditioning"), value: air() },
      { id: "barrierFree", label: t("building.facts.barrierFree"), value: yesNo(building.barrierFreeEntrance) },
    ],
    contactTitle: t("building.contactTitle"),
    contact: {
      provided: contact ? withDate(t, "building.providedByHub", contact.updatedAt, locale) : null,
      role: contact ? t(`building.roles.${CONTACT_ROLE_LABEL_KEYS[contact.role]}`) : null,
      phone: contact ? displayPhone(contact.phone) : null,
      telHref: contact ? telHref(contact.phone) : null,
      none: t("x09.unknown"),
      call: t("R31.call"),
      callIsEnglish: isEnglishFallback(t("R31.call")),
    },
  };
}

export { formatDay, type Translate };
