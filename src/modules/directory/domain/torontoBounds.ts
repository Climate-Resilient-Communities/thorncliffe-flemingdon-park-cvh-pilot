// The bounding box a pilot coordinate must fall in: the City of Toronto, with a little margin.
// db/migrations/20261002200000_provider_catalogue.sql repeats these four numbers in the
// provider_location check constraint, and a test keeps the two together.
//
// Defined here, in the directory module, because S01.13 (buildings) is built in parallel and no
// shared module exists yet; when both stories are merged this belongs in src/contracts so the
// buildings seed and the provider catalogue share it.
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
