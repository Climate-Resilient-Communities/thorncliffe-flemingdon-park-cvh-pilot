declare const offset: number;

export const physical = [
  { marginLeft: 4 },
  { paddingRight: "var(--gap-icon)" },
  { "padding-left": 0 },
  { borderLeftWidth: 1 },
  { textAlign: "left" },
  { float: "right" },
  { left: 0 },
  { right: "4px" },
];

export const logical = [
  { marginInlineStart: 4 },
  { textAlign: "start" },
  { insetInlineStart: 0 },
  { left: offset },
];

export type Offsets = { left: number; right: number };
