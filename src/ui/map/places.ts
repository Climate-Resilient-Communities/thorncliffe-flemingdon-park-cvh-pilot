import type { ListedBuilding } from "@/contracts/buildingList";
import type { ListingProvider, ListingText } from "@/contracts/directory";
import { inToronto } from "@/contracts/torontoBounds";

// What the map shows (S02.07, R-14, R-15): every published provider of the listing file the directory reads, one pin per
// place it is at, and the pilot buildings. Pure: the map and its list both read the pins from here, so the list always
// holds the same places as the part of the map on screen.

/**
 * The kinds of pin. Cooling spaces, water fountains and public washrooms each have their own shape, icon and a text label
 * (their name in the listing, in the page language), never a colour alone; every other provider is a service pin; a
 * building has its own square pin.
 */
export type MarkerKind = "cooling" | "water" | "washroom" | "service" | "building";

/** The English subcategory names (the catalogue's source text) that give a provider its own marker, first match wins. */
export const SPECIAL_SUBCATEGORIES: readonly { kind: Exclude<MarkerKind, "service" | "building">; english: string }[] = [
  { kind: "cooling", english: "Cooling Spaces" },
  { kind: "water", english: "Water Fountains" },
  { kind: "washroom", english: "Public Washrooms" },
];

export type ProviderPin = {
  kind: "provider";
  /** Unique per pin: a provider at two places has two pins. */
  key: string;
  id: string;
  name: string;
  street: string;
  lat: number;
  lng: number;
  marker: Exclude<MarkerKind, "building">;
  /** The words beside a special marker (the subcategory's name in the page language); null for a service pin. */
  label: ListingText | null;
};

export type BuildingPin = {
  kind: "building";
  key: string;
  rsn: string;
  address: string;
  neighbourhood: string;
  lat: number;
  lng: number;
  marker: "building";
};

export type MapPin = ProviderPin | BuildingPin;

export type Bounds = { south: number; west: number; north: number; east: number };

/**
 * Where the map opens, for everyone: Thorncliffe Park and Flemingdon Park whole. The map never opens on a resident's own
 * building, so the tiles it asks for at first are the same for every visitor and say nothing about where they live (AD-3).
 */
export const NEIGHBOURHOODS_VIEW: Bounds = { south: 43.6935, west: -79.3555, north: 43.7265, east: -79.3215 };

/** The marker kind of a provider: its first special subcategory, else a service. */
export function markerOf(provider: Pick<ListingProvider, "subcategories">): { marker: ProviderPin["marker"]; label: ListingText | null } {
  for (const special of SPECIAL_SUBCATEGORIES) {
    const text = provider.subcategories.find((sub) => sub.original.body.trim().toLowerCase() === special.english.toLowerCase());
    if (text) return { marker: special.kind, label: text };
  }
  return { marker: "service", label: null };
}

/** One pin per place of each provider (a place outside Toronto, a slip in the data, is left off the map). */
export function providerPins(providers: readonly ListingProvider[]): ProviderPin[] {
  const pins: ProviderPin[] = [];
  const seen = new Set<string>();
  for (const provider of providers) {
    if (seen.has(provider.id)) continue;
    seen.add(provider.id);
    const { marker, label } = markerOf(provider);
    provider.locations.forEach((location, at) => {
      if (!inToronto(location.lat, location.lng)) return;
      pins.push({ kind: "provider", key: `${provider.id}:${at}`, id: provider.id, name: provider.name, street: location.street, lat: location.lat, lng: location.lng, marker, label });
    });
  }
  return pins;
}

/** One pin per pilot building that has a place. */
export function buildingPins(buildings: readonly Pick<ListedBuilding, "rsn" | "address" | "neighbourhood" | "lat" | "lng">[]): BuildingPin[] {
  const pins: BuildingPin[] = [];
  for (const b of buildings) {
    if (b.lat === undefined || b.lng === undefined || !inToronto(b.lat, b.lng)) continue;
    pins.push({ kind: "building", key: `building:${b.rsn}`, rsn: b.rsn, address: b.address, neighbourhood: b.neighbourhood, lat: b.lat, lng: b.lng, marker: "building" });
  }
  return pins;
}

export const inBounds = (pin: Pick<MapPin, "lat" | "lng">, b: Bounds): boolean => pin.lat >= b.south && pin.lat <= b.north && pin.lng >= b.west && pin.lng <= b.east;

/**
 * The list view (R-15) of the part of the map on screen: each provider with a pin in `bounds` once, and each building in
 * `bounds`, by name (address) in the order of the page language. This is the screen reader's way to every place the map
 * shows, so it holds exactly the pins on screen.
 */
export function listInView(pins: readonly MapPin[], bounds: Bounds, locale: string): { providers: ProviderPin[]; buildings: BuildingPin[] } {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const providers: ProviderPin[] = [];
  const buildings: BuildingPin[] = [];
  const seen = new Set<string>();
  for (const pin of pins) {
    if (!inBounds(pin, bounds)) continue;
    if (pin.kind === "building") buildings.push(pin);
    else if (!seen.has(pin.id)) {
      seen.add(pin.id);
      providers.push(pin);
    }
  }
  providers.sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.id, b.id));
  buildings.sort((a, b) => collator.compare(a.address, b.address) || collator.compare(a.rsn, b.rsn));
  return { providers, buildings };
}

/** Where a pin leads: the provider's listing (R-12) or the building page, the same pages the directory opens. */
export function pinHref(pin: MapPin, lang: string): string {
  return pin.kind === "provider" ? `/${lang}/directory/${pin.id}` : `/${lang}/buildings/${pin.rsn}`;
}
