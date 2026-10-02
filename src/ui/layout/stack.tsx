import type { ReactNode } from "react";

export const STACK_GAPS = [
  "subline",
  "label",
  "tight",
  "related",
  "target",
  "icon",
  "grid",
  "stack",
  "section-resident",
  "section-hub",
  "section-hub-main",
  "section-hub-review",
  "panel",
  "paragraph",
] as const;

export type StackGap = (typeof STACK_GAPS)[number];

export type StackProps = {
  gap?: StackGap;
  align?: "stretch" | "start" | "center" | "end";
  as?: "div" | "ul" | "ol" | "section" | "fieldset";
  testId?: string;
  children?: ReactNode;
};

/** Children in the block direction with one token gap (components/stack.md). */
export function Stack({ gap = "stack", align = "stretch", as: Element = "div", testId, children }: StackProps) {
  return (
    <Element
      className="layout-stack"
      data-gap={gap}
      data-align={align}
      // Safari with VoiceOver drops list semantics from lists without list markers.
      role={Element === "ul" || Element === "ol" ? "list" : undefined}
      data-testid={testId}
    >
      {children}
    </Element>
  );
}
