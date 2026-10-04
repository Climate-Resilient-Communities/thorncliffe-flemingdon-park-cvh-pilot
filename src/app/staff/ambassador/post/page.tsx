import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { englishText } from "@/i18n/text";
import { Screen } from "@/ui";
import { staffPage } from "../../guard";
import { assignmentsOf } from "../../scope";
import { loadPost } from "./load";
import { PostForm } from "./PostForm";
import { AMBASSADOR_HOME, postScreen } from "./view";

export const metadata: Metadata = { title: englishText("A02.title") };

type Props = { searchParams?: Promise<{ alert?: string | string[] }> };

/** What the person is told when they cannot post here: no building assigned now, or an alert that is not theirs to add to. */
function Refusal({ message }: { message: string }) {
  return (
    <Screen surface="staff">
      <p role="alert" className="hub-error hub-wrap">
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
 * "Post a building update" (A-02, S08.02): an Ambassador posts what is happening on their floors, for one building they are assigned to now, as a new alert
 * or, with `?alert=`, as an update to an open alert about their building (in a drill, a practice post that goes to the Hub only). One phone screen; the post
 * is made and submitted in one request (POST /api/staff/ambassador/posts) and waits for the Hub's second person. The policy action is `alert.author`, judged
 * on the buildings the person is assigned to now (an Ambassador with none is refused; a Director never may). The Hub writes on its own screens, so another
 * role is told so and sent back to the Hub's home. Responses are no-store.
 */
export default staffPage<Props>(
  {
    route: "/staff/ambassador/post",
    access: "hub",
    action: "alert.author",
    context: async (session) => (session.role === "ambassador" ? { targets: (await assignmentsOf(session)).map((assignment) => assignment.rsn) } : {}),
    refused: (session) => {
      // A Director never posts here (the policy); the Hub's own screens are at its home.
      if (session.role !== "ambassador") redirect(AMBASSADOR_HOME);
      return <Refusal message={englishText("staff.ambassadorHome.notAssigned")} />;
    },
  },
  async (session, { searchParams }) => {
    // The Hub writes on its own screens (Log a disruption, Add an update): this one is a building ambassador's.
    if (session.role !== "ambassador") return <Refusal message={englishText("staff.ambassadorPost.hubNote")} />;
    const alertParam = ((await searchParams) ?? {}).alert;
    const loaded = await loadPost(session, typeof alertParam === "string" ? alertParam : undefined);
    if (!loaded.ok) return <Refusal message={loaded.reason === "not_assigned" ? englishText("staff.ambassadorHome.notAssigned") : englishText("A02.errClosed")} />;
    return (
      <Screen surface="staff">
        <PostForm screen={postScreen(loaded.data)} />
      </Screen>
    );
  },
);
