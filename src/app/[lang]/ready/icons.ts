// The six guides' marks: the hazard's own icon, from the shell's icon set (icons.css). A guide the set has no mark for gets none.
const GUIDE_ICONS: ReadonlySet<string> = new Set(["power", "flood", "elevator", "heat", "smoke", "fire"]);

/** The icon class of a guide, or null. */
export const guideIconClass = (id: string): string | null => (GUIDE_ICONS.has(id) ? `shell-ico--${id}` : null);
