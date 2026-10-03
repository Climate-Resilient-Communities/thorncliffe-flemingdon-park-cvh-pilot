// Which guides an alert links to (R-07, prototype R07 `GUIDE_FOR`): one for each disruption type that has one, in the order of the alert's types,
// each opened at "During" because the alert says it is happening now (the guide page focuses the `#during` heading, S02.10). The guides are the six
// the pilot launches with (power, flood, elevator, heat, smoke, fire). Water or plumbing is the flood and plumbing guide, as in the prototype, and a
// winter storm is read as the power one (its worst effects are power and elevator failures; a blizzard alert names those types too); "Other" has
// no guide. A test keeps every guide named here equal to a launch guide.

const GUIDE_FOR: Readonly<Record<string, string>> = {
  power: "power",
  elevator: "elevator",
  heat: "heat",
  smoke: "smoke",
  fire: "fire",
  flood: "flood",
  water: "flood",
  winter: "power",
};

/** The guide ids for an alert's types: distinct, in the order of the types. */
export function guidesFor(types: readonly string[]): string[] {
  const guides: string[] = [];
  for (const type of types) {
    const guide = GUIDE_FOR[type];
    if (guide !== undefined && !guides.includes(guide)) guides.push(guide);
  }
  return guides;
}

/** The address of a guide opened at "During". */
export const guideDuringHref = (lang: string, guide: string): string => `/${lang}/ready/${guide}#during`;

/** The guides the mapping may name (the test compares them with the launch guides). */
export const MAPPED_GUIDES: readonly string[] = [...new Set(Object.values(GUIDE_FOR))];
