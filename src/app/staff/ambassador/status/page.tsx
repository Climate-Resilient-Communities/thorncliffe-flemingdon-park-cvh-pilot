import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { uuidv7 } from "@/platform/ids";
import { Screen } from "@/ui";
import { staffPage } from "../../guard";
import { progressReader } from "../../sendingProgress";
import { loadPostStatus } from "../home";
import { StatusBody } from "./StatusBody";
import { notFoundScreen, statusScreen, type TextCounts } from "./view";

export const metadata: Metadata = { title: englishText("staff.ambassadorStatus.title") };

type Props = { searchParams?: Promise<{ entry?: string | string[] }> };

function NotFound() {
  const missing = notFoundScreen();
  return (
    <Screen surface="staff">
      <p role="alert" className="hub-error hub-wrap" data-testid="status-not-found">
        {missing.text}
      </p>
      <p>
        <a className="tap hub-link" href={missing.back.href}>
          {missing.back.label}
        </a>
      </p>
    </Screen>
  );
}

/**
 * Where an ambassador's post stands (A-03, S08.04): "Live. Not yet verified", "Waiting for the Hub", "Approved", "Returned to you" with the Hub's note,
 * "Withdrawn" (and "Corrected"), once approved how its texts are going (waiting, on their way, delivered, not delivered: counts only), and what the person may do:
 * correct or withdraw their own post that residents already read, and mark the alert resolved, each sent to the Hub for a second person's approval. Only the
 * person's own post in a real alert about buildings they are all still assigned to is shown; anything else, and every other role, reads the same "not found".
 * The policy action is `hub.open`, like the home this opens from; the data is read from the person's current assignments on each request. Responses are no-store.
 */
export default staffPage<Props>({ route: "/staff/ambassador/status", access: "hub", action: "hub.open" }, async (session, { searchParams }) => {
  if (session.role !== "ambassador") return <NotFound />;
  const asked = ((await searchParams) ?? {}).entry;
  const loaded = typeof asked === "string" ? await loadPostStatus(session, asked) : null;
  if (loaded === null) return <NotFound />;
  const approved = loaded.status.state === "approved" || loaded.status.state === "verified";
  const counts: TextCounts | null = approved ? (await progressReader().forEntry(loaded.status.entryId)).total : null;
  const at = Date.now();
  const screen = statusScreen({ ...loaded, counts, ids: { correct: uuidv7(at), withdraw: uuidv7(at), resolve: uuidv7(at) } });
  return (
    <Screen surface="staff">
      <StatusBody screen={screen} />
    </Screen>
  );
});
