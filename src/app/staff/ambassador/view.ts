// What the Ambassador's home shows (A-01, S08.01): the view model, with every text already resolved from the English catalog, so the component that draws it knows
// none of it. Pure: the page reads the data (./home.ts) and hands it here.
//
// Four parts, in the order a person on a phone needs them: which buildings and floors are theirs, what is happening in them (the open alerts residents are
// reading about them, newest first), their own posts with each one's state, and their round. Nothing links to posting yet (S08.02) or to the round (the
// round stories that follow): a link is added by the story that builds its page.
import type { AmbassadorAlert, AmbassadorPost } from "@/modules/alerting";
import { englishText } from "@/i18n/text";
import { formatTorontoDateTime } from "@/platform/clock";
import { typeName } from "../alerts/typeNames";

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
}

export interface PostItemView {
  key: string;
  /** "Elevator · Posted 2026-10-04 14:00". */
  title: string;
  text: string;
  state: string;
  about: string;
  note: string | null;
}

export interface AmbassadorHomeView {
  title: string;
  lead: string;
  /** Set instead of the rest when the person is assigned to no building. */
  notAssigned: string | null;
  assigned: string[];
  active: { title: string; none: string; items: AlertItemView[] };
  posts: { title: string; none: string; items: PostItemView[] };
  round: { title: string; line: string | null; none: string | null };
}

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
    active: {
      title: t("activeTitle"),
      none: t("activeNone"),
      items: alerts.map((alert) => ({
        key: `alert-${alert.alertId}`,
        title: alert.types.map(typeName).join(", "),
        headline: alert.headline,
        meta: [englishText("A01.fromHub"), alert.verified ? englishText("A01.verifiedWord") : englishText("A01.notVerifiedWord"), englishText("A01.postedAgo", { t: formatTorontoDateTime(alert.publishedAt) })].join(SEPARATOR),
        about: about(alert.buildings),
        until: t("until", { time: formatTorontoDateTime(alert.validUntil) }),
        link: { href: residentAlertHref(alert.slug), label: t("residentsRead") },
      })),
    },
    posts: {
      title: englishText("A01.myPosts"),
      none: t("postsNone"),
      items: posts.map((post) => ({
        key: `post-${post.entryId}`,
        title: t("postLine", { types: post.types.map(typeName).join(", "), time: formatTorontoDateTime(post.postedAt) }),
        text: post.text,
        state: post.state === "returned" ? t("states.returned") : englishText(`A03.states.${post.state}`),
        about: about(post.buildings),
        note: post.note === null ? null : t("returnedNote", { note: post.note }),
      })),
    },
    round: {
      title: t("roundTitle"),
      line: data.round === null ? null : data.round.requests === 1 ? t("roundCountOne") : t("roundCount", { n: data.round.requests }),
      none: data.round === null ? t("roundNone") : null,
    },
  };
}
