// The cache tag of one building's public facts (S02.08). The resident building page reads a building through a
// cache entry with this tag; the Admin's building screen drops the tag when it saves the contact, so residents
// see the new contact at once instead of after the entry expires.

/** How long a building's facts are kept before they are read again: the register changes when the seed runs, not by the minute. */
export const BUILDING_REVALIDATE_SECONDS = 300;

export const buildingTag = (rsn: string): string => `building:${rsn}`;
