import {
  matches,
  profileFromDevice,
  type Audience,
  type AudienceProfile,
} from "@/contracts/audience";
import type { BuildingList } from "@/contracts/buildingList";
import type { DeviceChoices } from "@/contracts/deviceChoices";
import { GROUPS } from "@/contracts/groups";

// How this phone tailors the alerts of the feed (S04.09, FR-A13, AR-26, AD-3). The feed is the same for everyone; what is for this
// resident is worked out here, from the choices saved on the phone, and nothing about the answer is sent anywhere. Tailoring only
// puts the alerts that are for the resident first and marks them, and adds one line of advice: it never hides an alert, and it never
// says which group or which choice made an alert theirs. Pure: the components only draw it.

/**
 * The profile of this phone for the shared matcher (S04.04), or null when there is nothing to tailor to yet. Tailoring is by place: a phone with no
 * saved building has none (the matcher would read an unknown neighbourhood as "every neighbourhood"), and while the building list is loading or
 * has failed the neighbourhood of a saved building is not known, so tailoring waits for it rather than mark alerts that are not the resident's.
 */
export function deviceProfile(
  choices: DeviceChoices | null,
  list: BuildingList | null,
): AudienceProfile | null {
  if (!choices || (choices.buildings ?? []).length === 0 || list === null)
    return null;
  return profileFromDevice(choices, list);
}

export interface Tailored<T> {
  thread: T;
  /** The alert is for this phone's owner by `matches`: it comes first, and it may carry the one line of advice. */
  matched: boolean;
  /** The alert is drawn marked: it matched while another did not. */
  highlighted: boolean;
}

/**
 * The threads in the order home shows them: those that match the profile first, then the rest, each in the order the feed gave them. Every thread
 * is in the result exactly once; none is dropped. When every alert matches, none is marked: a mark that every card has says nothing. With no profile
 * (nothing saved by place, or the building list not ready) the feed's own order, no mark and nothing matched: no advice either.
 */
export function tailorThreads<T extends { audience: Audience }>(
  threads: readonly T[],
  profile: AudienceProfile | null,
): Tailored<T>[] {
  if (profile === null || profile.places.length === 0) {
    return threads.map((thread) => ({
      thread,
      matched: false,
      highlighted: false,
    }));
  }
  const flagged = threads.map((thread) => ({
    thread,
    mine: matches(thread.audience, profile),
  }));
  const first = flagged.filter((entry) => entry.mine);
  const rest = flagged.filter((entry) => !entry.mine);
  const mark = first.length > 0 && rest.length > 0;
  return [
    ...first.map(({ thread }) => ({
      thread,
      matched: true,
      highlighted: mark,
    })),
    ...rest.map(({ thread }) => ({
      thread,
      matched: false,
      highlighted: false,
    })),
  ];
}

/** The groups that have advice in the catalog, in the order R-26 offers them; "a check-in" is a visit, not advice. */
export const ADVICE_GROUPS = GROUPS.filter((group) => group !== "checkin");

/**
 * The one line of advice for an alert that is for this phone: the first line the catalog has for one of the alert's types (in the alert's order)
 * and one of the groups the resident chose (in R-26's order). `lines(type, group)` is the catalog's list for that pair, or undefined. Null when
 * the alert is not for this phone, or the catalog has no such advice. The line says nothing of the group or of why it is shown.
 */
export function adviceFor(
  types: readonly string[],
  chosenGroups: readonly string[],
  lines: (type: string, group: string) => readonly string[] | undefined,
): string | null {
  for (const type of types) {
    for (const group of ADVICE_GROUPS) {
      if (!chosenGroups.includes(group)) continue;
      const first = lines(type, group)?.find((line) => line.trim() !== "");
      if (first !== undefined) return first;
    }
  }
  return null;
}
