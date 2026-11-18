// Which resources a guide's "Help with this" points to (resident testing, session 2, #18). A plain module, read by the page (server) and by
// the links (browser).
import type { FilterState } from "@/ui/directory/filters";

/** The directory's filters for a guide's "Services that can help". Every guide of the launch has an entry. */
export const GUIDE_SERVICES: Readonly<Record<string, Partial<FilterState>>> = {
  heat: { subcategories: ["cooling spaces", "water fountains"] },
  smoke: { subcategories: ["cooling spaces", "libraries"] },
  power: { subcategories: ["community centres", "libraries"] },
  flood: { topics: ["housing"] },
  fire: { topics: ["housing"] },
  elevator: { topics: ["seniors", "health"] },
};

/** The purpose of the spaces a guide points to (the prototype's F11: heat, smoke and outages only). */
export const GUIDE_SPACES: Readonly<Record<string, "cooling" | "cleanAir" | "charging">> = { heat: "cooling", smoke: "cleanAir", power: "charging" };

