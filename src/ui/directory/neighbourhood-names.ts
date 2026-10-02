import { NEIGHBOURHOOD_IDS, NeighbourhoodIdSchema, type NeighbourhoodId } from "@/contracts/directory";

// The two neighbourhoods of the pilot and their names. Which neighbourhood a provider is in is not worked out on the
// phone: the release file says it (`neighbourhood_ids`, from the Hub's reviewed list). The two names are place names,
// written in English on every page (as the building page writes them), so they are not in the translated catalog.
const NAMES: Readonly<Record<NeighbourhoodId, string>> = { TP: "Thorncliffe Park", FP: "Flemingdon Park" };

export const NEIGHBOURHOODS: readonly { id: NeighbourhoodId; name: string }[] = NEIGHBOURHOOD_IDS.map((id) => ({ id, name: NAMES[id] }));

export const isNeighbourhoodId = (value: unknown): value is NeighbourhoodId => NeighbourhoodIdSchema.safeParse(value).success;

export const neighbourhoodName = (id: NeighbourhoodId): string => NAMES[id];
