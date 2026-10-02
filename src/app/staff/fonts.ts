import publicSansLatin from "@fontsource-variable/public-sans/files/public-sans-latin-wght-normal.woff2";

// The staff screens are English, so the one web font they use is Public Sans, whose Latin and Latin-extended faces
// fonts.generated.css declares (scripts/gen-fonts.mjs writes it, with no Noto or script face). Their stack names
// "Public Sans" first (--type-family-sans); this file gives the layout the one file it preloads.

/** The URL of the Latin slice of Public Sans, which the stylesheet declares from the same file. */
export const PUBLIC_SANS_LATIN: string = typeof publicSansLatin === "string" ? publicSansLatin : publicSansLatin.src;
