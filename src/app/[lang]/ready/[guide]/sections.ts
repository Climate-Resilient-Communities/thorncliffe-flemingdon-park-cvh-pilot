// The parts of a guide, shared by the page (server) and the hash handler (browser). Not a client module: the page calls it.

/** The parts of a guide in the order they are read: a link ends in `#before`, `#during` or `#after` to open the guide at one. */
export const GUIDE_PARTS = ["before", "during", "after"] as const;

export type GuidePart = (typeof GUIDE_PARTS)[number];

/** The id of the heading of a part: the element that takes the focus when a link names the part. */
export const headingId = (part: string) => `${part}-heading`;
