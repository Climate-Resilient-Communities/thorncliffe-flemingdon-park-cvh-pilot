import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { can } from "@/modules/identity";
import { Screen } from "@/ui";
import { assignments } from "../assignments";
import { staffPage } from "../guard";
import { buildings } from "../places";
import { assignAmbassadorAction, removeAssignmentAction } from "./actions";
import { CoverageBody } from "./CoverageBody";
import { coverageBuildingView, coverageListView, coverageMissingView, savedNotice, type SavedQuery } from "./view";

export const metadata: Metadata = { title: englishText("staff.coverage.title") };

const actions = { assign: assignAmbassadorAction, remove: removeAssignmentAction };

type Query = SavedQuery & { building?: string | string[] };

/**
 * "Ambassador coverage" (S01.14): the policy action `coverage.view`, which an Admin and a Coordinator have and a
 * Director has read-only (S01.12). The list of the pilot buildings, each with its covered and uncovered floors in
 * words, and, with `?building=<rsn>`, one building's floors, who covers them and its assignments. Only an Admin
 * (`accounts.manage`) is given the forms to assign and remove; the actions refuse everyone else on their own.
 * Staff at the Hub only (the guard sends everyone else to sign-in or their setup gate); an Ambassador sees "Only
 * an Admin, a Coordinator or a Director can see coverage." Responses are no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage(
  {
    route: "/staff/coverage",
    access: "hub",
    action: "coverage.view",
    refused: () => (
      <Screen surface="staff">
        <p role="alert" className="hub-error">{englishText("staff.coverage.errors.forbidden")}</p>
      </Screen>
    ),
  },
  async (session, props: { searchParams?: Promise<Query> }) => {
    const query = (await props.searchParams) ?? {};
    const rsn = Array.isArray(query.building) ? query.building[0] : query.building;
    const notice = savedNotice(query);
    const [plans, all] = await Promise.all([buildings().listFloorPlans(), assignments().allAssignments()]);
    let screen;
    if (rsn === undefined) {
      screen = coverageListView(plans, all, notice);
    } else {
      const plan = plans.find((candidate) => candidate.rsn === rsn);
      const ambassadors = plan && can(session.role, "accounts.manage") ? await assignments().ambassadors() : undefined;
      screen = plan ? coverageBuildingView(plan, all, { notice, ambassadors }) : coverageMissingView();
    }
    return (
      <Screen surface="staff">
        <CoverageBody screen={screen} actions={actions} />
      </Screen>
    );
  },
);
