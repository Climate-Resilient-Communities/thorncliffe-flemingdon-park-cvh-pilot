import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { HANDLED_NOTE_MAX_CHARS } from "@/modules/checkins";
import { can, meetsAssurance } from "@/modules/identity";
import { Screen, Stack } from "@/ui";
import { staffPage } from "../../guard";
import { loadEscalation } from "../load";
import { ESCALATION_PAGE } from "../view";
import { EscalationBody } from "./EscalationBody";
import { HandleForm } from "./HandleForm";
import type { HandleLabels } from "./HandleFormView";

export const metadata: Metadata = { title: englishText("staff.rounds.title") };

const t = (key: string) => englishText(`staff.rounds.escalation.${key}`);

const labels = (): HandleLabels => ({ heading: t("markHeading"), note: t("note"), noteHint: t("noteHint"), mark: t("mark"), marking: t("marking"), noteMax: HANDLED_NOTE_MAX_CHARS });

/**
 * An escalation's page (S08.08, `?id=` the escalation): the page the on-duty Admin's text links to. The policy action is `checkins.escalations` (a
 * Coordinator, a Director read-only, an Admin). The resident's number, floor and method are read and shown only for `checkins.follow_up` (an Admin) whose
 * session is at aal2, while the row still names the resident and the escalation is not a late mark's; everyone else sees that only an Admin sees them
 * (direct-request tests). "Mark handled" is the same Admin's, at aal2 (its action's guard). Responses are no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage(
  {
    route: ESCALATION_PAGE,
    access: "hub",
    action: "checkins.escalations",
    refused: () => (
      <Screen surface="staff">
        <Stack gap="section-hub">
          <h1>{englishText("staff.rounds.title")}</h1>
          <p role="alert" className="hub-error">
            {englishText("staff.rounds.forbidden")}
          </p>
        </Stack>
      </Screen>
    ),
  },
  async (session, props: { searchParams?: Promise<{ id?: string | string[] }> }) => {
    const query = (await props.searchParams) ?? {};
    const id = Array.isArray(query.id) ? query.id[0] : query.id;
    const followUp = can(session.role, "checkins.follow_up");
    const screen = await loadEscalation(id, { followUp, aal2: followUp && meetsAssurance(session.role, session.aal, "checkins.follow_up") });
    if (screen.kind === "missing") {
      return (
        <Screen surface="staff">
          <Stack gap="related">
            <p role="alert" className="hub-error">
              {screen.message}
            </p>
            <a className="tap hub-link" href={screen.back.href}>
              {screen.back.label}
            </a>
          </Stack>
        </Screen>
      );
    }
    return (
      <Screen surface="staff">
        <EscalationBody screen={screen} form={followUp ? <HandleForm id={screen.id} open={screen.form?.kind === "mark"} labels={labels()} /> : null} />
      </Screen>
    );
  },
);
