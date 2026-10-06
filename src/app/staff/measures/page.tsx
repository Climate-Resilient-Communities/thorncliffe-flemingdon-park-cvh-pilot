import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { Screen, Stack } from "@/ui";
import { staffPage } from "../guard";
import { MeasuresView } from "./MeasuresView";
import { MEASURES_PAGE, measuresText } from "./view";

export const metadata: Metadata = { title: englishText("staff.measures.title") };

/**
 * "Pilot measures" (S07.10, FR-M1 subscribers, FR-M4, FR-M5): the subscribers the daily job counted, how far corrections, withdrawals and finals reached, and what
 * each alert cost. Counts only, read-only, no control. The policy action `coverage.view` opens the counts (a Coordinator, a Director read-only, an Admin); the cost
 * of an alert is `spend.view` (a Director and an Admin, AD-4) and is left out of a Coordinator's page. Under the lead (S09.05): the full set of measures is the
 * export an Admin writes (scripts/export-measures), with the link to its procedure. An Ambassador is sent to the Hub's home. A reading that
 * fails shows one line and nothing else. The shell (layout.tsx) owns the <main>; the response is never cached.
 */
export default staffPage({ route: MEASURES_PAGE, access: "hub", action: "coverage.view" }, async (session) => {
  try {
    return (
      <Screen surface="staff">
        <MeasuresView view={await (await import("./load")).loadMeasures(session.role)} />
      </Screen>
    );
  } catch (error) {
    console.log(JSON.stringify({ level: "error", evt: "measures.read_failed", module: "staff", error: error instanceof Error ? error.name : "NonError" }));
    return (
      <Screen surface="staff">
        <Stack gap="section-hub">
          <h1>{measuresText("title")}</h1>
          <p role="alert" className="hub-error" data-testid="measures-unreadable">
            {measuresText("errors.unreadable")}
          </p>
        </Stack>
      </Screen>
    );
  }
});
