import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { can } from "@/modules/identity";
import { Screen } from "@/ui";
import { staffPage } from "../../../guard";
import { loadProblemList, type SendingQuery } from "../load";
import { ProblemListBody } from "../SendingBody";
import { ResendAllForm, ResendOneForm } from "./ResendForms";

export const metadata: Metadata = { title: englishText("staff.sending.problems.title") };

// A resend that has committed starts a dispatcher run that lives in this function after the response (kickDispatcher, src/app/dispatch.ts): the segment needs the same 60
// seconds as the job route's run, a literal Next.js reads statically.
export const maxDuration = 60;

/**
 * The texts of an entry that failed, were undelivered or have an unknown outcome (S06.09), each with what it means in plain words ("Number not in service",
 * "Outcome unclear; not re-sent") and no phone number: `?alert=<id>&entry=<id>&state=failed|undelivered|unknown`. Its own view, apart from the counts. The policy
 * action is `alert.author_wide`, like the progress view; the page itself changes nothing. An Admin (the policy action `delivery.resend`, at aal2 for the actions) also
 * sees "Resend" on a text and "Resend the failed and undelivered texts in {language}" (S09.02); their server actions (./actions.ts) ask the guard again. Responses are
 * no-store. The shell (layout.tsx) owns the <main>.
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
  async (session, props: { searchParams?: Promise<SendingQuery> }) => {
    const screen = await loadProblemList((await props.searchParams) ?? {}, undefined, undefined, { canResend: can(session.role, "delivery.resend") });
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
        <ProblemListBody screen={screen} resend={{ one: (view) => <ResendOneForm view={view} />, all: (view) => <ResendAllForm view={view} /> }} />
      </Screen>
    );
  },
);
