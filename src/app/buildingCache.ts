// The cache tag of one building's public facts (S02.08). The resident building page reads a building through a
// cache entry with this tag; the Admin's building screen drops the tag when it saves the contact, so the app serves
// the new contact at once. A shared cache in front of the app may still hold the old page for up to about 6 minutes
// (s-maxage=300 plus stale-while-revalidate=60, next.config.ts), so that is how long a saved change can take to
// reach every resident.

/** How long a building's facts are kept before they are read again: the register changes when the seed runs, not by the minute. */
export const BUILDING_REVALIDATE_SECONDS = 300;

export const buildingTag = (rsn: string): string => `building:${rsn}`;
