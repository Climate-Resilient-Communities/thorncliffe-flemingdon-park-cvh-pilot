import { Grid } from "@/ui";

export const styles = "@media (width >= 800px) { .compose { display: grid } }";

export default function Compose() {
  return (
    <Grid twoColumn="aside">
      <div />
      <div />
    </Grid>
  );
}
