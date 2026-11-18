"use client";

import { useTranslations } from "next-intl";
import type { ListingText } from "@/contracts/directory";
import { ResidentText } from "../text/resident-text";
import { ListingBlock } from "./listing-text";

// The plain names of the catalogue's categories and subcategories (resident testing, session 2, #10: "the community asset map should be
// problem- and solution-oriented; category and subcategory language need to be plainer"). The catalogue keeps its own names, which search
// reads, so matching does not change; residents see the interface's plain words (`catPlain`, `subcats`, keyed by the catalogue's English),
// in every language, and the catalogue's words for a name the interface has none for.

export type KindGroup = "catPlain" | "subcats";

const keyOf = (group: KindGroup, text: ListingText) => `${group}.${text.original.body.trim()}`;

/** The plain name as a string (a remove button's name, a pin's words), or null when the interface has none. */
export function usePlainName(): (group: KindGroup, text: ListingText) => string | null {
  const t = useTranslations();
  return (group, text) => {
    const key = keyOf(group, text);
    return t.has(key) ? t(key) : null;
  };
}

/** A category or a subcategory as residents read it: its plain name, else the catalogue's words. */
export function KindName({ group, text, contentLang }: { group: KindGroup; text: ListingText; contentLang?: Parameters<typeof ListingBlock>[0]["contentLang"] }) {
  const plain = usePlainName()(group, text);
  return plain !== null ? <ResidentText>{plain}</ResidentText> : <ListingBlock text={text} as="span" contentLang={contentLang} />;
}

/** Kinds of place in the order of the names residents read (their plain names), in the page's language. */
export function byPlainName<T extends { name: ListingText }>(kinds: readonly T[], plainName: ReturnType<typeof usePlainName>, locale: string): T[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const nameOf = (kind: T) => plainName("subcats", kind.name) ?? kind.name.body;
  return [...kinds].sort((a, b) => collator.compare(nameOf(a), nameOf(b)));
}
