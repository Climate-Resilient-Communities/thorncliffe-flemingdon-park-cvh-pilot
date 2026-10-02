// A fixture for the spacing check. Keys that are not CSS property names are cast to never to type-check.
// Type annotations such as `gap: string` are not style values and are not flagged.
export const Quoted = () => <div style={{ "margin-top": "-4px" } as never} />;

export const Single = () => <div style={{ 'padding-left': '13px' } as never} />;

export const Identifier = (size: number) => <div style={{ padding: size }} />;

export const Member = (props: { gap: string }) => <div style={{ rowGap: props.gap }} />;

export const Fine = () => <div style={{ padding: "var(--gap-icon)", gap: 0, margin: "-0", columnGap: "normal" }} />;

export const Excepted = (size: number) => <div style={{ padding: size }} />; /* spacing-exception: measured at runtime */

export type Props = { gap: string; padding: number; margin?: number };
