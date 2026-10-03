// What the map says about its tiles (S02.07, AR-3).
//
// - The provider allows keeping viewed tiles: parts of the map viewed before draw from the phone; where a tile on screen
//   was never kept and cannot be downloaded, the map shows a plain background and "This part of the map is not saved on
//   your phone". The pins and the list keep working from the saved listing file.
// - The provider does not allow it: nothing is kept, so without signal "The map is not available without signal", with
//   the list view offered in its place.

export type MapNotice = "not-saved" | "no-signal" | null;

export function mapNotice(state: { cacheable: boolean; online: boolean; missingTiles: number }): MapNotice {
  if (state.cacheable) return state.missingTiles > 0 ? "not-saved" : null;
  return !state.online || state.missingTiles > 0 ? "no-signal" : null;
}
