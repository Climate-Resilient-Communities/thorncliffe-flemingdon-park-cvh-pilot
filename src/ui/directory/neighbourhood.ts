import type { ListingProvider } from "@/contracts/directory";

// The listing file carries no neighbourhood: a provider has an address, a postal code and a point on the map. The phone
// works the neighbourhood out from the first three characters of the postal code (the forward sortation area), the one
// part of an address that is written the same way in every language. Thorncliffe Park is M4H and Flemingdon Park is M3C.
// A provider with another postal code, or none, is in neither neighbourhood: it is listed with no filter and is left out
// when a neighbourhood is chosen. The two names are place names, written in English on every page (as the building page
// writes them), so they are not in the translated catalog.
export const NEIGHBOURHOODS = [
  { id: "TP", name: "Thorncliffe Park", postalAreas: ["M4H"] },
  { id: "FP", name: "Flemingdon Park", postalAreas: ["M3C"] },
] as const;

export type NeighbourhoodId = (typeof NEIGHBOURHOODS)[number]["id"];

export const isNeighbourhoodId = (value: unknown): value is NeighbourhoodId => NEIGHBOURHOODS.some(({ id }) => id === value);

export const neighbourhoodName = (id: NeighbourhoodId): string => NEIGHBOURHOODS.find((n) => n.id === id)!.name;

/** The neighbourhoods a provider's addresses are in, by postal code. */
export function neighbourhoodsOf(provider: Pick<ListingProvider, "locations">): NeighbourhoodId[] {
  const found = new Set<NeighbourhoodId>();
  for (const location of provider.locations) {
    const area = location.postal?.replace(/\s+/g, "").slice(0, 3).toUpperCase();
    const match = NEIGHBOURHOODS.find((n) => (n.postalAreas as readonly string[]).includes(area ?? ""));
    if (match) found.add(match.id);
  }
  return [...found];
}
