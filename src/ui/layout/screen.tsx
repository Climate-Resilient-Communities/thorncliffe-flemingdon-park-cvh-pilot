import type { ReactNode } from "react";
import { ScreenActions } from "./screen-actions";

export const SCREEN_WIDTHS = ["default", "review", "published", "log", "update", "resolve", "partner"] as const;

export type ScreenWidth = (typeof SCREEN_WIDTHS)[number];

type Surface =
  /** Resident and ambassador screens: fluid, never capped (G5). */
  | { surface: "resident"; width?: never }
  /** Hub screens: a named maximum inline size only on the screens that already use it. */
  | { surface: "staff"; width?: ScreenWidth };

type Actions =
  | { actions: ReactNode; actionsLabel: string }
  | { actions?: undefined; actionsLabel?: undefined };

export type ScreenProps = Surface &
  Actions & {
    inset?: "default" | "none";
    bleed?: ReactNode;
    testId?: string;
    children?: ReactNode;
  };

/**
 * The content area of one screen (components/screen.md): its gutter, block insets, section gap and
 * maximum inline size, an optional full-width bleed region and a sticky actions region. The staff
 * body is the hub-page query container that two-column Grids measure.
 */
export function Screen(props: ScreenProps) {
  const { surface, inset = "default", bleed, testId, children } = props;
  return (
    <div
      className="layout-screen"
      data-surface={surface}
      data-width={surface === "staff" ? (props.width ?? "default") : undefined}
      data-inset={inset}
      data-testid={testId}
    >
      {bleed !== undefined && <div className="layout-screen__bleed">{bleed}</div>}
      <div className="layout-screen__body">{children}</div>
      {props.actions !== undefined && <ScreenActions label={props.actionsLabel}>{props.actions}</ScreenActions>}
    </div>
  );
}
