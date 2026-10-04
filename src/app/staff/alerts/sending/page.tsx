import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { Screen } from "@/ui";
import { staffPage } from "../../guard";
import { loadSending, type SendingQuery } from "./load";
import { SendingBody } from "./SendingBody";

export const metadata: Metadata = { title: englishText("staff.sending.title") };

/**
 * The alert's staff view of an entry's sending progress (S06.09, O-06): per language how many texts are waiting, in flight (handed to the provider),
 * delivered, undelivered, failed, unknown and cancelled, reloaded every 15 seconds while texts are going out, with the lists of the texts that did not arrive
 * in their own view (`/staff/alerts/sending/texts`). The policy action is `coverage.view` ("See counts and coverage": an Admin and a Coordinator, and a
 * Director read-only); the page changes nothing. No phone number is read or shown. A drill's entry points to the Drills page, which keeps drills apart from
 * real alerts (S06.05). Responses are no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage(
  {
    route: "/staff/alerts/sending",
    access: "hub",
    action: "coverage.view",
    refused: () => (
      <Screen surface="staff" width="review">
        <p role="alert" className="hub-error">
          {englishText("staff.sending.errors.forbidden")}
        </p>
      </Screen>
    ),
  },
  async (_session, props: { searchParams?: Promise<SendingQuery> }) => {
    const screen = await loadSending((await props.searchParams) ?? {});
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
        <SendingBody screen={screen} />
      </Screen>
    );
  },
);
