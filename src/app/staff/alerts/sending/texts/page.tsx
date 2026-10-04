import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { Screen } from "@/ui";
import { staffPage } from "../../../guard";
import { loadProblemList, type SendingQuery } from "../load";
import { ProblemListBody } from "../SendingBody";

export const metadata: Metadata = { title: englishText("staff.sending.problems.title") };

/**
 * The texts of an entry that failed, were undelivered or have an unknown outcome (S06.09), each with what it means in plain words ("Number not in service",
 * "Outcome unclear; not re-sent") and no phone number: `?alert=<id>&entry=<id>&state=failed|undelivered|unknown`. Its own view, apart from the counts. The policy
 * action is `alert.author_wide`, like the progress view; the page changes nothing. Responses are no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage(
  {
    route: "/staff/alerts/sending/texts",
    access: "hub",
    action: "alert.author_wide",
    refused: () => (
      <Screen surface="staff" width="review">
        <p role="alert" className="hub-error">
          {englishText("staff.sending.errors.forbidden")}
        </p>
      </Screen>
    ),
  },
  async (_session, props: { searchParams?: Promise<SendingQuery> }) => {
    const screen = await loadProblemList((await props.searchParams) ?? {});
    if (screen.kind === "missing") {
      return (
        <Screen surface="staff" width="review">
          <p role="alert" className="hub-error">
            {screen.message}
          </p>
          <a className="tap hub-link" href={screen.back.href}>
            {screen.back.label}
          </a>
        </Screen>
      );
    }
    return (
      <Screen surface="staff" width="review">
        <ProblemListBody screen={screen} />
      </Screen>
    );
  },
);
