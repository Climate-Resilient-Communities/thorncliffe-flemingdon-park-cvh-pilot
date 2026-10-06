// What the Ambassador's home shows (A-01, S08.01): the view model, with every text already resolved from the English catalog, so the component that draws it knows
// none of it. Pure: the page reads the data (./home.ts) and hands it here.
//
// Four parts, in the order a person on a phone needs them: which buildings and floors are theirs, what is happening in them (the open alerts residents are
// reading about them, newest first), their own posts with each one's state, and their round. Each part links to the page a later story built: posting
// (S08.02), a post's status (S08.04) and, while a round is open for their floors, "My round" (S08.07).
import { BUILDING_TYPES } from "@/contracts/alertContent";
import { ROUND_PAGE } from "@/contracts/checkinRound";
import type { AmbassadorAlert, AmbassadorDrill, AmbassadorPost } from "@/modules/alerting";
import { englishText } from "@/i18n/text";
import { formatTorontoDateTime } from "@/platform/clock";
import { typeName } from "../alerts/typeNames";
import { resolveHref, statusHref } from "./status/view";

export type Text = (key: string, values?: Record<string, string | number>) => string;

/** The words of this screen: `staff.ambassadorHome.<key>` of the catalog. */
export const catalogText: Text = (key, values) => englishText(`staff.ambassadorHome.${key}`, values);

/** One building the person is assigned to, with the floors written out. */
export interface AssignedBuilding {
  rsn: string;
  address: string;
  /** The labels of the assigned floors in the building's order; null for every floor. */
  floorLabels: readonly string[] | null;
}

export interface AmbassadorHomeData {
  buildings: readonly AssignedBuilding[];
  alerts: readonly AmbassadorAlert[];
  posts: readonly AmbassadorPost[];
  /** S08.02: the open drills about their buildings, kept apart; absent is none. */
  drills?: readonly AmbassadorDrill[];
  /** The open round's requests for the person's floors; null while no round is open. */
  round: { requests: number } | null;
}

export interface AlertItemView {
  key: string;
  /** "Elevator, Power". */
  title: string;
  /** The text residents read. */
  headline: string;
  /** "From the Hub · Verified · Posted 2026-10-04 14:00". */
  meta: string;
  /** "About 4 Milepost Pl" */
  about: string;
  until: string;
  /** The page residents read it on. */
  link: { href: string; label: string };
  /** S08.02: "Post an update about this" (A-02 for this alert), for an alert of the types an Ambassador posts; null for the Hub's neighbourhood-wide ones. */
  postLink: { href: string; label: string } | null;
  /** S08.04: "Mark resolved" (the final message of this alert), for an alert about exactly one building they are assigned to; null otherwise. */
  resolveLink: { href: string; label: string } | null;
}

/** An open drill about their buildings (S08.02), apart from the alerts: a practice post goes to the Hub only. */
export interface DrillItemView {
  key: string;
  title: string;
  headline: string;
  about: string;
  /** Null for a drill of a type an Ambassador may not post (heat, smoke, winter: the Hub's, for the whole neighbourhood). */
  link: { href: string; label: string } | null;
}

export interface PostItemView {
  key: string;
  /** "Elevator · Posted 2026-10-04 14:00". */
  title: string;
  text: string;
  state: string;
  about: string;
  note: string | null;
  /** S08.04: where the post stands and what can be done about it (A-03). */
  link: { href: string; label: string };
}

export interface AmbassadorHomeView {
  title: string;
  lead: string;
  /** Set instead of the rest when the person is assigned to no building. */
  notAssigned: string | null;
  assigned: string[];
  /** S08.02: "Post a building update" (A-02); null for a person assigned to no building. */
  post: { href: string; label: string } | null;
  active: { title: string; none: string; items: AlertItemView[] };
  posts: { title: string; none: string; items: PostItemView[] };
  /** S08.07: with a round open for their floors, "Open my round" (A-04). */
  round: { title: string; line: string | null; none: string | null; link: { href: string; label: string } | null };
  /** S08.02: the open drills about their buildings, apart; null while there is none. */
  drills: { title: string; lead: string; items: DrillItemView[] } | null;
}

/** The post screen (A-02, S08.02); with an alert, an update to it. */
export const ambassadorPostHref = (alertId?: string): string => (alertId ? `/staff/ambassador/post?${new URLSearchParams({ alert: alertId }).toString()}` : "/staff/ambassador/post");

/** An Ambassador posts updates of these types only (heat, smoke and winter storm are the Hub's, for a whole neighbourhood). */
const postable = (types: readonly string[]) => types.every((type) => (BUILDING_TYPES as readonly string[]).includes(type));

const SEPARATOR = " · ";

/** The line that says which floors of a building are the person's. */
function assignedLine(building: AssignedBuilding, t: Text): string {
  return building.floorLabels === null || building.floorLabels.length === 0
    ? t("assignedAll", { building: building.address })
    : t("assignedFloors", { building: building.address, floors: building.floorLabels.join(", ") });
}

/** The resident page of an alert's thread (the same page residents read: R-07). */
export const residentAlertHref = (slug: string): string => `/en/alerts/${slug}`;

export function ambassadorHomeView(data: AmbassadorHomeData, t: Text = catalogText): AmbassadorHomeView {
  const addresses = new Map(data.buildings.map((building) => [building.rsn, building.address]));
  const about = (rsns: readonly string[]) => t("about", { places: rsns.map((rsn) => addresses.get(rsn) ?? rsn).join(", ") });
  const notAssigned = data.buildings.length === 0;
  const alerts = [...data.alerts].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  const posts = [...data.posts].sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
  return {
    title: data.buildings.length > 1 ? t("titleMany") : t("title"),
    lead: t("lead"),
    notAssigned: notAssigned ? t("notAssigned") : null,
    assigned: data.buildings.map((building) => assignedLine(building, t)),
    post: notAssigned ? null : { href: ambassadorPostHref(), label: englishText("A01.post") },
    active: {
      title: t("activeTitle"),
      none: t("activeNone"),
      items: alerts.map((alert) => ({
        key: `alert-${alert.alertId}`,
        title: alert.types.map(typeName).join(", "),
        headline: alert.headline,
        meta: [englishText(alert.fromAmbassador ? "A01.fromAmb" : "A01.fromHub"), alert.verified ? englishText("A01.verifiedWord") : englishText("A01.notVerifiedWord"), englishText("A01.postedAgo", { t: formatTorontoDateTime(alert.publishedAt) })].join(SEPARATOR),
        about: about(alert.buildings),
        until: t("until", { time: formatTorontoDateTime(alert.validUntil) }),
        link: { href: residentAlertHref(alert.slug), label: t("residentsRead") },
        postLink: postable(alert.types) ? { href: ambassadorPostHref(alert.alertId), label: t("postUpdate") } : null,
        resolveLink: alert.canResolve === true ? { href: resolveHref(alert.alertId), label: englishText("staff.ambassadorStatus.resolveLink") } : null,
      })),
    },
    posts: {
      title: englishText("A01.myPosts"),
      none: t("postsNone"),
      items: posts.map((post) => ({
        key: `post-${post.entryId}`,
        title: t("postLine", { types: post.types.map(typeName).join(", "), time: formatTorontoDateTime(post.postedAt) }),
        text: post.text,
        // "Withdrawn" and "Corrected" are the ambassador's own act as often as the Hub's (S08.04), so the list does not say "by the Hub" for them.
        state:
          post.state === "returned"
            ? t("states.returned")
            : post.state === "withdrawn" || post.state === "corrected"
              ? englishText(`staff.ambassadorStatus.${post.state}Title`)
              : englishText(`A03.states.${post.state}`),
        about: about(post.buildings),
        note: post.note === null ? null : t("returnedNote", { note: post.note }),
        link: { href: statusHref(post.entryId), label: englishText("staff.ambassadorStatus.statusLink") },
      })),
    },
    round: {
      title: t("roundTitle"),
      line: data.round === null ? null : data.round.requests === 1 ? t("roundCountOne") : t("roundCount", { n: data.round.requests }),
      none: data.round === null ? t("roundNone") : null,
      link: data.round === null ? null : { href: ROUND_PAGE, label: englishText("A01.openRound") },
    },
    drills:
      (data.drills ?? []).length === 0
        ? null
        : {
            title: t("drillsTitle"),
            lead: t("drillsLead"),
            items: (data.drills ?? []).map((drill) => ({
              key: `drill-${drill.alertId}`,
              title: drill.types.map(typeName).join(", "),
              headline: drill.headline,
              about: about(drill.buildings),
              link: postable(drill.types) ? { href: ambassadorPostHref(drill.alertId), label: t("practicePost") } : null,
            })),
          },
  };
}
