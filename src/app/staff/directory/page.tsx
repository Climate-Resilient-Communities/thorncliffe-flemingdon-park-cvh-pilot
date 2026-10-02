import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { currentReleaseSummary, latestReleaseSummary, listProviders, torontoDate } from "@/modules/directory";
import { Screen, Stack } from "@/ui";
import { directoryDb } from "../directory";
import { staffPage } from "../guard";
import { DirectoryRelease } from "./DirectoryRelease";
import { directoryReleaseView } from "./view";

export const metadata: Metadata = { title: englishText("staff.directory.title") };

// Publishing runs in the server action of this page: enough time for all the files, and the job's retries. The job
// stops retrying after PUBLISH_BUDGET_MS (40 s) and its lease outlasts this by a margin (test/publishBudget.test.ts).
export const maxDuration = 60;

function DirectoryHeading() {
  return (
    <Stack gap="related">
      <h1>{englishText("staff.directory.title")}</h1>
      <p>{englishText("staff.directory.lead")}</p>
    </Stack>
  );
}

/**
 * "Directory release" (S02.05): the current release, what it held back, the last failed publish if it is newer,
 * and the "Publish directory" button. The policy action `guide.publish`, Admins only (S01.12); its action runs at
 * aal2 (S01.10). Another role sees "Only an Admin can publish the directory." and nothing else. Responses are
 * no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage(
  {
    route: "/staff/directory",
    access: "hub",
    action: "guide.publish",
    refused: () => (
      <Screen surface="staff">
        <Stack gap="section-hub">
          <DirectoryHeading />
          <p role="alert" className="hub-error">{englishText("staff.directory.errors.forbidden")}</p>
        </Stack>
      </Screen>
    ),
  },
  async () => {
    const db = directoryDb();
    const [current, latest, providers] = await Promise.all([currentReleaseSummary(db), latestReleaseSummary(db), listProviders(db)]);
    const inCatalogue = providers.filter((p) => p.inCatalogue);
    const view = directoryReleaseView(current, latest, { published: inCatalogue.filter((p) => p.published).length, total: inCatalogue.length }, torontoDate, new Date());
    return (
      <Screen surface="staff">
        <Stack gap="section-hub">
          <DirectoryHeading />
          <DirectoryRelease view={view} />
        </Stack>
      </Screen>
    );
  },
);
