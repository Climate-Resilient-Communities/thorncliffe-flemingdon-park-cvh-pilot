// What the buildings screen shows (S01.13): the view models for the list and for one building, with
// every text already resolved from the English catalog, so the components that draw them know none of it.
import { englishText } from "@/i18n/text";
import type { BuildingDetail, BuildingSummary } from "@/modules/places";
import { BUILDINGS_PAGE } from "./editFloors";

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.buildings.${key}`, values);

/** A date as the Hub's staff read it: the day in Toronto. */
export const formatDay = (date: Date): string => new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "America/Toronto" }).format(date);

export interface ListItemView {
  rsn: string;
  address: string;
  href: string;
  /** "Edit floors of 4 Milepost Pl", the link's accessible name. */
  linkLabel: string;
  edit: string;
  storeys: string;
  floors: string;
  status: { confirmed: boolean; text: string };
  /** "Register" and "Not in latest register": a labelled line of its own. */
  notInRegister?: { label: string; status: string };
}

export interface ListView {
  kind: "list";
  title: string;
  lead: string;
  notice?: string;
  empty?: string;
  groups: { id: string; name: string; items: ListItemView[] }[];
}

export interface FloorRowView {
  id: string;
  label: string;
  /** "Label of the floor now called 3": the input's accessible name. */
  inputLabel: string;
  /** "Rename floor 3" and "Remove floor 3": each button's accessible name. */
  renameName: string;
  removeName: string;
  /** The confirm step of a removal: "Yes, remove floor 3" and "Keep floor 3". */
  removeYes: string;
  removeKeep: string;
  note?: string;
}

export interface BuildingView {
  kind: "building";
  rsn: string;
  address: string;
  neighbourhood: string;
  notice?: string;
  back: { href: string; label: string };
  status: { confirmed: boolean; text: string };
  notInRegister?: { title: string; line: string };
  facts: { title: string; updated: string; items: { label: string; value: string }[] };
  floors: { title: string; lead: string; empty?: string; rows: FloorRowView[]; rename: string; remove: string };
  add: { title: string; label: string; hint: string; place: string; top: string; bottom: string; submit: string };
  confirm?: { title: string; lead: string; submit: string };
  contact: {
    title: string;
    lead: string;
    /** "Provided by the Hub, last updated Oct 1, 2026", or "No contact entered yet." */
    current: string;
    role: string;
    roleHint: string;
    phone: string;
    phoneHint: string;
    submit: string;
    /** What the form starts with: the saved contact. */
    value: { role: string; phone: string };
  };
}

export interface MissingView {
  kind: "missing";
  message: string;
  back: { href: string; label: string };
}

export type BuildingsScreen = ListView | BuildingView | MissingView;

/** The query of a page shown after a saved change: only well-formed values are read back. */
export interface SavedQuery {
  done?: string | string[];
  label?: string | string[];
  from?: string | string[];
  to?: string | string[];
  n?: string | string[];
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const LABEL = /^[A-Za-z0-9 -]{1,8}$/;
const COUNT = /^[0-9]{1,3}$/;

/**
 * What the page tells the person about the change they just saved, or nothing for a query that is not one.
 *
 * The notice is read from the query string, so anyone who can open this page can make it say "Floor 3
 * renamed to 3A" without a change having been saved. Accepted: the page is Admin-only, the values are
 * limited to the floor label alphabet (1 to 8 letters, digits, spaces, hyphens) or a count, the text is
 * rendered as text and fixed by our own strings, and the notice changes nothing and grants nothing.
 */
export function savedNotice(query: SavedQuery): string | undefined {
  const label = first(query.label);
  const from = first(query.from);
  const to = first(query.to);
  const n = first(query.n);
  switch (first(query.done)) {
    case "added":
      return label && LABEL.test(label) ? t("saved.added", { label }) : undefined;
    case "renamed":
      return from && to && LABEL.test(from) && LABEL.test(to) ? t("saved.renamed", { from, to }) : undefined;
    case "removed":
      return label && LABEL.test(label) ? t("saved.removed", { label }) : undefined;
    case "confirmed":
      return n && COUNT.test(n) ? t("saved.confirmed", { n }) : undefined;
    case "contact":
      return t("saved.contact");
    case "contactRemoved":
      return t("saved.contactRemoved");
    default:
      return undefined;
  }
}

const yesNo = (value: boolean | null) => (value === null ? t("unknown") : value ? t("yes") : t("no"));
const orUnknown = (value: string | number | null) => (value === null ? t("unknown") : String(value));

const statusOf = (building: BuildingSummary) =>
  building.confirmedAt ? { confirmed: true, text: t("confirmed") } : { confirmed: false, text: t("unconfirmed") };

export function listView(buildings: readonly BuildingSummary[], notice?: string): ListView {
  const groups = new Map<string, ListView["groups"][number]>();
  for (const building of buildings) {
    const group = groups.get(building.neighbourhoodId) ?? { id: building.neighbourhoodId, name: building.neighbourhoodName, items: [] };
    group.items.push({
      rsn: building.rsn,
      address: building.address,
      href: `${BUILDINGS_PAGE}?building=${building.rsn}`,
      linkLabel: t("editOf", { address: building.address }),
      edit: t("edit"),
      storeys: building.storeys === null ? t("storeysUnknown") : t("storeysRegister", { n: building.storeys }),
      floors: t("floorsCount", { n: building.floorCount }),
      status: statusOf(building),
      ...(building.notInRegisterSince ? { notInRegister: { label: t("registerLabel"), status: t("notInRegister") } } : {}),
    });
    groups.set(building.neighbourhoodId, group);
  }
  return {
    kind: "list",
    title: t("title"),
    lead: t("lead"),
    ...(notice ? { notice } : {}),
    ...(buildings.length === 0 ? { empty: t("empty") } : {}),
    groups: [...groups.values()],
  };
}

export function buildingView(building: BuildingDetail, notice?: string): BuildingView {
  const { facts } = building;
  return {
    kind: "building",
    rsn: building.rsn,
    address: building.address,
    neighbourhood: building.neighbourhoodName,
    ...(notice ? { notice } : {}),
    back: { href: BUILDINGS_PAGE, label: t("back") },
    status: building.confirmedAt ? { confirmed: true, text: t("confirmedOn", { date: formatDay(building.confirmedAt) }) } : { confirmed: false, text: t("unconfirmed") },
    ...(building.notInRegisterSince ? { notInRegister: { title: t("notInRegister"), line: t("notInRegisterLine") } } : {}),
    facts: {
      title: t("factsTitle"),
      updated: t("factsUpdated", { date: formatDay(facts.updatedAt) }),
      items: [
        { label: t("facts.storeys"), value: orUnknown(building.storeys) },
        { label: t("facts.elevators"), value: orUnknown(facts.elevators) },
        { label: t("facts.emergencyPower"), value: yesNo(facts.emergencyPower) },
        { label: t("facts.coolingRoom"), value: yesNo(facts.coolingRoom) },
        { label: t("facts.airConditioning"), value: orUnknown(facts.airConditioning) },
        { label: t("facts.barrierFree"), value: yesNo(facts.barrierFreeEntrance) },
      ],
    },
    floors: {
      title: t("floorsTitle"),
      lead: t("floorsLead"),
      ...(building.floors.length === 0 ? { empty: t("noFloors") } : {}),
      rows: building.floors.map((floor) => ({
        id: floor.id,
        label: floor.label,
        inputLabel: t("floorLabel", { label: floor.label }),
        renameName: t("renameOf", { label: floor.label }),
        removeName: t("removeOf", { label: floor.label }),
        removeYes: t("removeYes", { label: floor.label }),
        removeKeep: t("removeKeep", { label: floor.label }),
        ...(floor.confirmed ? {} : { note: t("floorUnconfirmed") }),
      })),
      rename: t("rename"),
      remove: t("remove"),
    },
    add: {
      title: t("add.title"),
      label: t("add.label"),
      hint: t("add.hint"),
      place: t("add.place"),
      top: t("add.top"),
      bottom: t("add.bottom"),
      submit: t("add.submit"),
    },
    contact: {
      title: t("contact.title"),
      lead: t("contact.lead"),
      current: building.contact ? t("contact.current", { date: formatDay(building.contact.updatedAt) }) : t("contact.none"),
      role: t("contact.role"),
      roleHint: t("contact.roleHint"),
      phone: t("contact.phone"),
      phoneHint: t("contact.phoneHint"),
      submit: t("contact.submit"),
      value: { role: building.contact?.role ?? "", phone: building.contact?.phone ?? "" },
    },
    ...(building.confirmedAt ? {} : { confirm: { title: t("confirm.title"), lead: t("confirm.lead"), submit: t("confirm.submit") } }),
  };
}

export function missingView(): MissingView {
  return { kind: "missing", message: t("errors.buildingNotFound"), back: { href: BUILDINGS_PAGE, label: t("back") } };
}
