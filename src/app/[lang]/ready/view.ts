// What the Be ready pages show of a building's contact (S02.10): the cards of the essential-numbers page, with every
// text already taken from the language's catalog. A plain module with no framework import, so a unit test can build it
// from the stored contacts and a translator.
import { CONTACT_ROLE_LABEL_KEYS, displayPhone, isContactRole, telHref } from "@/modules/places";
import { withDate, type Translate } from "../../residentDates";
import type { StoredBuildingContact } from "./source";

/** One building's card on the essential-numbers page. The phone picks the cards of its chosen buildings from the full list (AD-3). */
export interface BuildingContactCard {
  rsn: string;
  address: string;
  /** The role's translated label ("Superintendent"); null when the Hub has entered no contact. */
  role: string | null;
  /** The number as people read it: (416) 555-0123. */
  phone: string | null;
  /** What the call link opens: tel:+14165550123. */
  tel: string | null;
  /** "Provided by the Hub, last updated October 1, 2026". */
  provided: string | null;
  /** "Call Superintendent, (416) 555-0123": what a screen reader says for the call link. */
  callAria: string | null;
}

export function buildingContactCards(list: readonly StoredBuildingContact[], t: Translate, locale: string): BuildingContactCard[] {
  return list.map(({ rsn, address, contact }) => {
    if (!contact || !isContactRole(contact.role)) {
      return { rsn, address, role: null, phone: null, tel: null, provided: null, callAria: null };
    }
    const role = t(`building.roles.${CONTACT_ROLE_LABEL_KEYS[contact.role]}`);
    const phone = displayPhone(contact.phone);
    return {
      rsn,
      address,
      role,
      phone,
      tel: telHref(contact.phone),
      provided: withDate(t, "building.providedByHub", new Date(contact.updatedAt), locale),
      callAria: `${t("R31.calling", { what: role })}, ${phone}`,
    };
  });
}
