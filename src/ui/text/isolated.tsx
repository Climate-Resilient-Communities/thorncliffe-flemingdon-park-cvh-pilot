import type { ReactNode } from "react";
import { ResidentText, isEnglishFallback } from "./resident-text";

/**
 * Text that is not the resident's language but is put inside it: a street address, a neighbourhood, a floor label such
 * as "G" or "2B". Without isolation, the bidi algorithm lets a right-to-left page reorder it ("85 Thorncliffe Park Dr"
 * can come out as "Dr Thorncliffe Park 85") and a screen reader reads it in the page's voice.
 */

/** FIRST STRONG ISOLATE and POP DIRECTIONAL ISOLATE: the same isolation for text that cannot hold an element, such as an aria-label. */
export const FSI = "⁨";
export const PDI = "⁩";

/** `item` as one isolated run inside a plain string (an aria-label). */
export const isolatedInString = (item: string): string => `${FSI}${item}${PDI}`;

/** An address, neighbourhood or other place text on its own: an isolated left-to-right run in English. */
export function Isolated({ children }: { children: string }): ReactNode {
  return (
    <bdi lang="en" dir="ltr">
      {children}
    </bdi>
  );
}

/**
 * A string of the catalog (ResidentText inline), or, with `isolate`, a place text (Isolated). Something that is already
 * an element is shown as it is: the caller has isolated what needs it.
 */
export function Words({ children, isolate = false }: { children: ReactNode; isolate?: boolean }): ReactNode {
  if (typeof children !== "string") return children;
  return isolate ? <Isolated>{children}</Isolated> : <ResidentText>{children}</ResidentText>;
}

// A character no message contains, put where the value goes so that the message can be cut around it.
const SLOT = "";

/**
 * A catalog message with one value in it, the value isolated: `format` is the message with the value filled in (for
 * example `(q) => t("noMatch", { q })`). The message is formatted with a slot in place of the value and cut there, so
 * the catalog string stays as it is. `dir` is "ltr" for text that is always left to right (a floor label, an address) and
 * "auto" for what the resident typed, in any script. A message that fell back to English is one isolated English run, as ResidentText makes it.
 */
export function withIsolated(format: (value: string) => string, value: ReactNode, dir: "ltr" | "auto" = "ltr"): ReactNode {
  const text = format(SLOT);
  const [before, after = ""] = text.split(SLOT);
  const parts = (
    <>
      {before}
      <bdi dir={dir}>{value}</bdi>
      {after}
    </>
  );
  return isEnglishFallback(text) ? (
    <bdi lang="en" dir="ltr">
      {parts}
    </bdi>
  ) : (
    parts
  );
}

/**
 * The result of `t.rich`: the same for a message that fell back to English as ResidentText makes of a plain string, one
 * isolated English run. (The "[EN] " marker is at the start of the first chunk.)
 */
export function richResident(node: ReactNode): ReactNode {
  const first = Array.isArray(node) ? node[0] : node;
  return typeof first === "string" && isEnglishFallback(first) ? (
    <bdi lang="en" dir="ltr">
      {node}
    </bdi>
  ) : (
    node
  );
}
