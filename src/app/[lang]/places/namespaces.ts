// The place suggestion screens (PRD §6.3; R-17 to R-23) run on the phone, so their client components get just these parts of the language's
// catalog: their own screens (R17 to R23, places), the rules (x03), what they share with the map and the directory (R12 "Not known" and "This
// place could not be found", R14's zoom buttons, R15's distance, the directory's loading words) and the shell's Back.
export const PLACES_NAMESPACES = ["R12", "R14", "R15", "R17", "R18", "R19", "R20", "R21", "R22", "R23", "x03", "places", "directory", "shell"] as const;
