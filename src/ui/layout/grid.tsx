import type { ReactNode } from "react";

export const GRID_GAPS = ["target", "grid", "stack", "panel"] as const;
export const GRID_TWO_COLUMNS = ["aside", "aside-compact", "even", "even-inner"] as const;

export type GridGap = (typeof GRID_GAPS)[number];
export type GridTwoColumn = (typeof GRID_TWO_COLUMNS)[number];

type GridBase = {
  as?: "div" | "ul" | "ol";
  testId?: string;
};

/** Equal columns at every width; one column in basic mode unless collapseInBasic is false. */
type EqualColumns = GridBase & {
  cols?: 1 | 2 | 3 | 4;
  gap?: GridGap;
  collapseInBasic?: boolean;
  twoColumn?: never;
  children?: ReactNode;
};

/**
 * A two-column Hub page or block (staff only): the main column, then the aside. One column below
 * the two-column container width (app-container-hub-two-column-min) of the hub-page container,
 * two at or above; the variant sets the sizes and gaps.
 */
type TwoColumns = GridBase & {
  twoColumn: GridTwoColumn;
  cols?: never;
  gap?: never;
  collapseInBasic?: never;
  children: [main: ReactNode, aside: ReactNode];
};

export type GridProps = EqualColumns | TwoColumns;

/** Equal-column grids and two-column Hub pages (components/grid.md). */
export function Grid(props: GridProps) {
  const { as: Element = "div", testId, children } = props;
  const layout =
    props.twoColumn !== undefined
      ? { "data-two-column": props.twoColumn }
      : {
          "data-cols": props.cols ?? 1,
          "data-gap": props.gap ?? "grid",
          "data-collapse-in-basic": props.collapseInBasic === false ? "false" : "true",
        };
  return (
    <Element className="layout-grid" {...layout} role={Element === "div" ? undefined : "list"} data-testid={testId}>
      {children}
    </Element>
  );
}
