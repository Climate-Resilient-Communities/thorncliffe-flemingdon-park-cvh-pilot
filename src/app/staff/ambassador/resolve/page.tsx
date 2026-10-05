import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { englishText } from "@/i18n/text";
import { uuidv7 } from "@/platform/ids";
import { Screen } from "@/ui";
import { staffPage } from "../../guard";
import { assignmentsOf } from "../../scope";
import { loadResolvable } from "../home";
import { ResolveBody } from "../status/StatusBody";
import { AMBASSADOR_HOME } from "../post/view";
import { resolveScreen } from "../status/view";

export const metadata: Metadata = { title: englishText("staff.ambassadorStatus.resolveTitle") };

type Props = { searchParams?: Promise<{ alert?: string | string[] }> };

function Refusal({ message }: { message: string }) {
  return (
    <Screen surface="staff">
      <p role="alert" className="hub-error hub-wrap" data-testid="resolve-refused">
        {message}
      </p>
      <p>
        <a className="tap hub-link" href={AMBASSADOR_HOME}>
          {englishText("A03.toHome")}
        </a>
      </p>
    </Screen>
  );
}

/**
 * "Mark resolved" (S08.04, A-03): an ambassador writes the final message of an open alert about their one building. The final goes to the Hub for a second person's
 * approval and the alert stays open until then; this page closes nothing. The policy action is `alert.author`, judged on the buildings the person is assigned to now
 * (an Ambassador with none is refused; a Director never may); the alert named by `?alert=` must be open, not a drill, have something residents read and be about exactly
 * one building they are assigned to, or the page says it cannot be resolved by them. The Hub resolves on its own screen, so another role is sent back to its home.
 * Responses are no-store.
 */
export default staffPage<Props>(
  {
    route: "/staff/ambassador/resolve",
    access: "hub",
    action: "alert.author",
    context: async (session) => (session.role === "ambassador" ? { targets: (await assignmentsOf(session)).map((assignment) => assignment.rsn) } : {}),
    refused: (session) => {
      if (session.role !== "ambassador") redirect(AMBASSADOR_HOME);
      return <Refusal message={englishText("staff.ambassadorHome.notAssigned")} />;
    },
  },
  async (session, { searchParams }) => {
    if (session.role !== "ambassador") return <Refusal message={englishText("staff.ambassadorPost.hubNote")} />;
    const asked = ((await searchParams) ?? {}).alert;
    const found = typeof asked === "string" ? await loadResolvable(session, asked) : null;
    if (found === null || typeof asked !== "string") return <Refusal message={englishText("staff.ambassadorStatus.resolveUnavailable")} />;
    const screen = resolveScreen({ alertId: asked, headline: found.headline, waitingFinal: found.waitingFinal, entryId: uuidv7() });
    return (
      <Screen surface="staff">
        <ResolveBody screen={screen} />
      </Screen>
    );
  },
);
