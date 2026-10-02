// Type tests for the layout primitives' props (components/*.md acceptance criteria). Every line
// marked with an expect-error directive must fail to compile, so `npm run typecheck` fails as soon
// as a primitive starts accepting an invalid prop. Nothing here is rendered.
import { Grid, Inline, Screen, Stack } from "@/ui";

export const valid = (
  <Screen surface="staff" width="review" actions={<button>Approve</button>} actionsLabel="Approval">
    <Grid twoColumn="aside">
      <Stack gap="section-hub-main">main</Stack>
      <Stack as="ul" gap="stack">
        <li>aside</li>
      </Stack>
    </Grid>
    <Grid cols={3} gap="target" collapseInBasic={false} as="ul">
      <li>a</li>
    </Grid>
    <Inline gap="meta-inline" justify="between" wrap={false} as="p">
      <Inline.Grow as="span">title</Inline.Grow>
    </Inline>
    <Screen surface="resident" inset="none" bleed={<div />} testId="r-03" />
  </Screen>
);

export const invalidScreen = [
  // @ts-expect-error surface is "resident" or "staff"
  <Screen surface="hub" key="surface" />,
  // @ts-expect-error inset is "default" or "none"
  <Screen surface="staff" inset="small" key="inset" />,
  // @ts-expect-error width is a named Hub page width
  <Screen surface="staff" width="wide" key="width" />,
  // @ts-expect-error resident content is never capped
  <Screen surface="resident" width="default" key="resident-width" />,
  // @ts-expect-error no style pass-through
  <Screen surface="staff" style={{ padding: 8 }} key="style" />,
  // @ts-expect-error no className pass-through
  <Screen surface="staff" className="p-card" key="className" />,
  // @ts-expect-error actions need an accessible name
  <Screen surface="staff" actions={<button />} key="actions" />,
];

export const invalidStack = [
  // @ts-expect-error gap is a token name, not a number
  <Stack gap={12} key="number" />,
  // @ts-expect-error gap is a token name, not a length
  <Stack gap="12px" key="length" />,
  // @ts-expect-error gap is a token name, not a T-shirt size
  <Stack gap="md" key="tshirt" />,
  // @ts-expect-error no className pass-through
  <Stack className="mt-4" key="className" />,
  // @ts-expect-error no justify
  <Stack justify="between" key="justify" />,
];

export const invalidInline = [
  // @ts-expect-error gap is a token name, not a length
  <Inline gap="10px" key="length" />,
  // @ts-expect-error justify="around" is not offered
  <Inline justify="around" key="around" />,
  // @ts-expect-error no style pass-through
  <Inline style={{ gap: 8 }} key="style" />,
  // @ts-expect-error Inline.Grow takes only as and children
  <Inline.Grow className="flex-1" key="grow" />,
];

export const invalidGrid = [
  // @ts-expect-error cols is 1 to 4
  <Grid cols={6} key="cols" />,
  // @ts-expect-error gap is a token name, not a length
  <Grid gap="17px" key="gap" />,
  // @ts-expect-error a twoColumn grid takes its gaps from its variant
  <Grid twoColumn="aside" gap="grid" key="two-column-gap">
    <div />
    <div />
  </Grid>,
  // @ts-expect-error cols and twoColumn do not combine
  <Grid twoColumn="even" cols={2} key="two-column-cols">
    <div />
    <div />
  </Grid>,
  // @ts-expect-error twoColumn is one of the four approved variants
  <Grid twoColumn="thirds" key="variant">
    <div />
    <div />
  </Grid>,
  // @ts-expect-error a twoColumn grid has exactly a main column and an aside
  <Grid twoColumn="aside" key="three-children">
    <div />
    <div />
    <div />
  </Grid>,
];
