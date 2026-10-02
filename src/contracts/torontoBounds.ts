// The bounding box a pilot coordinate must fall in: the City of Toronto, which spans roughly 43.58 to
// 43.86 degrees north and 79.64 to 79.11 degrees west. It catches the usual data mistakes: latitude and
// longitude swapped, a missing sign, a point at 0,0 or in another city; it does not check that a point
// is in the right neighbourhood. Shared by the buildings seed (S01.13) and the provider catalogue (S02.04).
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
