import type { ReactNode } from "react";

export const INLINE_GAPS = [
  "label",
  "tight",
  "related",
  "target",
  "icon",
  "grid",
  "stack",
  "panel",
  "meta-inline",
  "type-grid-inline",
] as const;

export type InlineGap = (typeof INLINE_GAPS)[number];

export type InlineProps = {
  gap?: InlineGap;
  align?: "center" | "start" | "end" | "baseline" | "stretch";
  justify?: "start" | "center" | "end" | "between";
  wrap?: boolean;
  as?: "div" | "ul" | "p";
  testId?: string;
  children?: ReactNode;
};

export type InlineGrowProps = {
  as?: "div" | "span";
  children?: ReactNode;
};

/** Takes the remaining inline space and may shrink, so long translated text wraps inside it. */
function InlineGrow({ as: Element = "div", children }: InlineGrowProps) {
  return <Element className="layout-inline__grow">{children}</Element>;
}

/** Children in the inline direction with one token gap, wrapping by default (components/inline.md). */
export function Inline({
  gap = "icon",
  align = "center",
  justify = "start",
  wrap = true,
  as: Element = "div",
  testId,
  children,
}: InlineProps) {
  return (
    <Element
      className="layout-inline"
      data-gap={gap}
      data-align={align}
      data-justify={justify}
      data-wrap={wrap ? "true" : "false"}
      role={Element === "ul" ? "list" : undefined}
      data-testid={testId}
    >
      {children}
    </Element>
  );
}

Inline.Grow = InlineGrow;
