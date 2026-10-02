// The UI layer's import surface: app code imports from "@/ui", never from a file inside src/ui/.
export { Grid, GRID_GAPS, GRID_TWO_COLUMNS, type GridGap, type GridProps, type GridTwoColumn } from "./layout/grid";
export { Inline, INLINE_GAPS, type InlineGap, type InlineGrowProps, type InlineProps } from "./layout/inline";
export { Screen, SCREEN_WIDTHS, type ScreenProps, type ScreenWidth } from "./layout/screen";
export { Stack, STACK_GAPS, type StackGap, type StackProps } from "./layout/stack";
export { FALLBACK_MARKER, ResidentText, isEnglishFallback } from "./text/resident-text";
