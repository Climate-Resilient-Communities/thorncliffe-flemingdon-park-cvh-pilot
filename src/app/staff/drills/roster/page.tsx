import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { stdoutMessagingLog } from "@/modules/messaging";
import { Screen, Stack } from "@/ui";
import { drillRoster } from "../../../drills";
import { staffPage } from "../../guard";
import { DRILL_ROSTER_PAGE, languageName } from "../view";
import { RosterForms } from "./RosterForms";
import type { RosterLabels, RosterRow } from "./RosterFormsView";
import { RosterView } from "./RosterView";
import { languageChoices } from "./view";

export const metadata: Metadata = { title: englishText("staff.drillRoster.title") };

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.drillRoster.${key}`, values);

function Heading() {
  return (
    <Stack gap="related">
      <h1>{t("title")}</h1>
      <p>{t("lead")}</p>
    </Stack>
  );
}

const labels = (): RosterLabels => ({
  listHeading: t("listHeading"),
  empty: t("empty"),
  emptyConsequence: t("emptyConsequence"),
  hidden: t("hidden"),
  addHeading: t("addHeading"),
  label: t("label"),
  labelHint: t("labelHint"),
  number: t("number"),
  numberHint: t("numberHint"),
  language: t("language"),
  add: t("add"),
  adding: t("adding"),
  edit: t("edit"),
  editNumberHint: t("editNumberHint"),
  save: t("save"),
  saving: t("saving"),
  remove: t("remove"),
  removing: t("removing"),
});

/** The roster as the page shows it (masked numbers only), or that it could not be read. */
async function readRows(): Promise<{ rows: RosterRow[]; unreadable: boolean }> {
  try {
    const entries = await drillRoster().list();
    return {
      rows: entries.map((entry) => ({
        id: entry.id,
        label: entry.label,
        masked: entry.masked,
        lang: entry.lang,
        languageLine: t("languageLine", { language: languageName(entry.lang) }),
        editFor: t("editFor", { label: entry.label }),
        removeFor: t("removeFor", { label: entry.label }),
      })),
      unreadable: false,
    };
  } catch (error) {
    stdoutMessagingLog.error("drill_roster.list_failed", { module: "subscriptions", error: error instanceof Error ? error.name : "NonError" });
    return { rows: [], unreadable: true };
  }
}

/**
 * "Drill roster" (S06.05): the staff phones a drill is texted on, each with the language of its drill text, with Add, Edit and Remove. The policy action
 * `drill.run`, Admins only (S01.12); its actions run at aal2 (S01.10). Another role sees "Only an Admin can change the drill roster." and nothing else. Numbers are
 * shown masked to their last four digits and are in no log or audit record. Responses are no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage(
  {
    route: DRILL_ROSTER_PAGE,
    access: "hub",
    action: "drill.run",
    refused: () => (
      <Screen surface="staff">
        <Stack gap="section-hub">
          <Heading />
          <p role="alert" className="hub-error">
            {t("errors.forbidden")}
          </p>
        </Stack>
      </Screen>
    ),
  },
  async () => {
    const { rows, unreadable } = await readRows();
    return (
      <Screen surface="staff">
        <RosterView count={rows.length} unreadable={unreadable} forms={<RosterForms rows={rows} languages={languageChoices()} labels={labels()} />} />
      </Screen>
    );
  },
);
