import { Grid } from "@/ui";

export default function Home() {
  return (
    <Grid twoColumn="aside">
      <div className="min-[700px]:flex" />
      <div className="@min-[800px]:grid" />
    </Grid>
  );
}
