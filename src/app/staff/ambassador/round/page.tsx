import type { Metadata } from "next";
import { ROUND_PAGE } from "@/contracts/checkinRound";
import { englishText } from "@/i18n/text";
import { Screen } from "@/ui";
import { staffPage } from "../../guard";
import { RoundPage } from "./RoundPage";
import { roundScreen } from "./view";

export const metadata: Metadata = { title: englishText("A04.title") };

/**
 * "My round" (A-04, S08.07): the check-ins asked for on the floors an Ambassador covers, during an open round, marked in one tap, even without signal. The
 * page itself holds no round: it is drawn empty and reads the round from POST /api/staff/ambassador/round (no-store), keeping it in the open page's memory
 * only (AD-1's one exception on the staff surface; never the service worker, never a storage API). Every staff member may open it (`hub.open`): what each
 * sees is the round API's (an Ambassador the requests on the floors they cover now, an Admin every request, a Coordinator or a Director counts only), and
 * each mark is judged by its own route (`checkins.mark`). The page is no-store like every staff page, and the service worker never answers it.
 */
export default staffPage({ route: ROUND_PAGE, access: "hub", action: "hub.open" }, (session) => (
  <Screen surface="staff">
    <RoundPage screen={roundScreen(session.role)} />
  </Screen>
));
