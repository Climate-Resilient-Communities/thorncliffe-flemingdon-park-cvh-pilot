import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { can } from "@/modules/identity";
import { Screen, Stack } from "@/ui";
import { staffPage } from "../../guard";
import { loadReview } from "../load";
import { MODERATION_PAGE, REVIEW_PAGE, reviewHref } from "../view";
import { DecideForms } from "./DecideForms";
import { decideLabels } from "./labels";
import { ReviewBody } from "./ReviewBody";

export const metadata: Metadata = { title: englishText("staff.moderation.title") };

type Props = { searchParams?: Promise<{ id?: string | string[]; decline?: string | string[] }> };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * A suggestion's review (O-09, `?id=` the suggestion) and its decline with a reason (O-10, `&decline=1`), PRD §6.3. The page is `moderation.view`
 * (a Coordinator, a Director read-only, an Admin); the forms are shown to `moderation.review` (a Coordinator and an Admin), and their actions
 * are guarded by it again. Responses are no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage<Props>(
  {
    route: REVIEW_PAGE,
    access: "hub",
    action: "moderation.view",
    refused: () => (
      <Screen surface="staff">
        <Stack gap="section-hub">
          <h1>{englishText("staff.moderation.title")}</h1>
          <p role="alert" className="hub-error">
            {englishText("staff.moderation.forbidden")}
          </p>
        </Stack>
      </Screen>
    ),
  },
  async (session, { searchParams }) => {
    const query = (await searchParams) ?? {};
    const screen = await loadReview(first(query.id));
    if (!screen) {
      return (
        <Screen surface="staff">
          <Stack gap="related">
            <p role="alert" className="hub-error">
              {englishText("staff.moderation.notFound")}
            </p>
            <a className="tap hub-link" href={MODERATION_PAGE}>
              {englishText("O09.back")}
            </a>
          </Stack>
        </Screen>
      );
    }
    const mayDecide = can(session.role, "moderation.review");
    const decide = mayDecide ? (
      <DecideForms
        id={screen.id}
        waiting={screen.status === "pending"}
        declining={first(query.decline) === "1"}
        reasons={screen.reasons}
        labels={decideLabels(screen.name, screen.kind)}
        hrefs={{ decline: reviewHref(screen.id, true), review: reviewHref(screen.id), queue: MODERATION_PAGE, next: screen.next }}
      />
    ) : null;
    return (
      <Screen surface="staff">
        <ReviewBody screen={screen} decide={decide} readOnly={mayDecide ? null : englishText("staff.moderation.readOnly")} />
      </Screen>
    );
  },
);
