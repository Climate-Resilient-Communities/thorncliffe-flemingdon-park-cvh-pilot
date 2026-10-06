import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { stdoutMessagingLog } from "@/modules/messaging";
import { Screen, Stack } from "@/ui";
import { onDutyCandidates, onDutyName, oncallRoster } from "../../oncall";
import { staffPage } from "../guard";
import { OncallForms } from "./OncallForms";
import type { OncallLabels, OncallRow } from "./OncallFormsView";
import { OncallView } from "./OncallView";
import { ONCALL_PAGE, onDutyView, type OnDutyView } from "./view";

export const metadata: Metadata = { title: englishText("staff.oncall.title") };

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.oncall.${key}`, values);

function Heading() {
  return (
    <Stack gap="related">
      <h1>{t("title")}</h1>
      <p>{t("lead")}</p>
    </Stack>
  );
}

const labels = (): OncallLabels => ({
  listHeading: t("listHeading"),
  empty: t("empty"),
  emptyConsequence: t("emptyConsequence"),
  hidden: t("hidden"),
  addHeading: t("addHeading"),
  label: t("label"),
  labelHint: t("labelHint"),
  number: t("number"),
  numberHint: t("numberHint"),
  add: t("add"),
  adding: t("adding"),
  remove: t("remove"),
  removing: t("removing"),
  onDuty: {
    heading: t("onDuty.heading"),
    lead: t("onDuty.lead"),
    badge: t("onDuty.badge"),
    number: t("onDuty.number"),
    account: t("onDuty.account"),
    accountHint: t("onDuty.accountHint"),
    noAccount: t("onDuty.noAccount"),
    noNumber: t("onDuty.noNumber"),
    set: t("onDuty.set"),
    setting: t("onDuty.setting"),
    clear: t("onDuty.clear"),
    clearing: t("onDuty.clearing"),
  },
});

/**
 * The roster as the page shows it (masked numbers only), and (S08.08) the on-duty section: what is set now, the entries by label and the Admin accounts that can
 * be on duty; or that the roster could not be read.
 */
async function readRows(): Promise<{ rows: OncallRow[]; onDuty?: OnDutyView; unreadable: boolean }> {
  try {
    const roster = oncallRoster();
    const [entries, state, accounts] = await Promise.all([roster.list(), roster.onDutyState(), onDutyCandidates()]);
    const name = state.kind === "none" ? null : await onDutyName(state.staffId);
    return {
      rows: entries.map((entry) => ({ id: entry.id, label: entry.label, masked: entry.masked, removeFor: t("removeFor", { label: entry.label }), onDuty: entry.onDuty })),
      onDuty: onDutyView({ entries, state: state.kind, accounts, onDutyName: name }),
      unreadable: false,
    };
  } catch (error) {
    stdoutMessagingLog.error("oncall.list_failed", { module: "ops", error: error instanceof Error ? error.name : "NonError" });
    return { rows: [], unreadable: true };
  }
}

/**
 * "On-call numbers" (S06.07): the roster of the Admins texted when sending is stuck or failing, with Add and Remove. The policy action
 * `oncall.manage`, Admins only (S01.12); its actions run at aal2 (S01.10). Another role sees "Only an Admin can change the on-call numbers."
 * and nothing else. Numbers are shown masked to their last four digits and are in no log or audit record. Responses are no-store. The shell
 * (layout.tsx) owns the <main>. S08.08: the on-duty Admin for check-ins, an entry of this list linked to an active Admin account with an authenticator,
 * chosen here ("Set on duty", "Nobody on duty"), with what is set now.
 */
export default staffPage(
  {
    route: ONCALL_PAGE,
    access: "hub",
    action: "oncall.manage",
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
    const { rows, onDuty, unreadable } = await readRows();
    return (
      <Screen surface="staff">
        <OncallView count={rows.length} unreadable={unreadable} forms={<OncallForms rows={rows} labels={labels()} onDuty={onDuty} />} />
      </Screen>
    );
  },
);
