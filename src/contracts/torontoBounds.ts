// The bounding box a pilot coordinate must fall in: the City of Toronto, with a little margin.
// db/migrations/20261002200000_provider_catalogue.sql repeats these four numbers in the
// provider_location check constraint, and a test keeps the two together.
//
// Shared by the provider catalogue (S02.04) and the buildings seed (S01.13), so it lives in src/contracts.
export const TORONTO_BOUNDS = { minLat: 43.58, maxLat: 43.86, minLng: -79.64, maxLng: -79.11 } as const;

/** True when the point is a finite coordinate inside the Toronto bounding box. */
export function inToronto(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= TORONTO_BOUNDS.minLat &&
    lat <= TORONTO_BOUNDS.maxLat &&
    lng >= TORONTO_BOUNDS.minLng &&
    lng <= TORONTO_BOUNDS.maxLng
  );
}
