import { useEffect, useState } from "react";
import { OPEN_SPACES_URL, OpenSpacesSchema, UNCONFIRMED_AFTER_MS, type OpenSpace } from "@/contracts/openSpaces";

// The spaces open for residents right now (the partner space, 2026-11-07), as the map ("Open as a space now") and a provider's page read them:
// the same request for every visitor (no query, no body, no credentials), so the server never learns which place a resident looks at (AD-3).
// The page keeps the answer for a minute; without signal, or when the server cannot answer, nothing is shown as a space, never a guess.

/** How long this open page keeps the list it loaded: a space fills in minutes, so not long. */
export const OPEN_SPACES_MAX_AGE_MS = 60 * 1000;

type Loaded = { at: number; list: Promise<OpenSpace[] | null> };
let pending: Loaded | undefined;

/** The open and full spaces, or null when they cannot be loaded (a failure is not remembered, so the next call tries again). */
export function loadOpenSpaces(fetcher: typeof fetch = fetch, now: () => number = Date.now): Promise<OpenSpace[] | null> {
  if (pending && now() - pending.at >= OPEN_SPACES_MAX_AGE_MS) pending = undefined;
  if (pending) return pending.list;
  const entry: Loaded = {
    at: now(),
    list: (async () => {
      try {
        const response = await fetcher(OPEN_SPACES_URL, { credentials: "omit", cache: "no-cache", headers: { Accept: "application/json" } });
        // The body is always read, so a refusal does not leave the request open.
        const text = await response.text();
        if (!response.ok) return null;
        const parsed = OpenSpacesSchema.safeParse(JSON.parse(text));
        return parsed.success ? parsed.data.spaces : null;
      } catch {
        return null;
      }
    })().then((list) => {
      if (list === null && pending === entry) pending = undefined;
      return list;
    }),
  };
  pending = entry;
  return entry.list;
}

/** Test seam: forget the list this page has loaded. */
export function resetOpenSpaces(): void {
  pending = undefined;
}

/** The spaces by the place they are at (the directory's provider id). */
export function spacesByProvider(spaces: readonly OpenSpace[] | null): ReadonlyMap<string, OpenSpace> {
  return new Map((spaces ?? []).map((space) => [space.provider_id, space]));
}

/** True when nobody has confirmed an open or full space for longer than the Hub allows: residents are told to call before they go. */
export function isUnconfirmedSpace(space: Pick<OpenSpace, "updated_at">, now: number = Date.now()): boolean {
  return now - Date.parse(space.updated_at) > UNCONFIRMED_AFTER_MS;
}

export type LoadedSpaces = { spaces: ReadonlyMap<string, OpenSpace>; /** When the list came in (ms), the "now" its confirmations are judged against. */ at: number };

const NONE: LoadedSpaces = { spaces: new Map(), at: 0 };

/** The open and full spaces for a component: none until (and unless) the list loads. */
export function useOpenSpaces(): LoadedSpaces {
  const [loaded, setLoaded] = useState<LoadedSpaces>(NONE);
  useEffect(() => {
    let live = true;
    void loadOpenSpaces().then((list) => {
      if (live && list) setLoaded({ spaces: spacesByProvider(list), at: Date.now() });
    });
    return () => {
      live = false;
    };
  }, []);
  return loaded;
}
