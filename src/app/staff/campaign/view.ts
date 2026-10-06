// What the End of the pilot page says (S09.07), built from what subscriptions and messaging read: before the start, the rehearsal and the confirmation (the deadline,
// the subscribers who will be asked per language, the estimated cost and the cap); while it runs, who started it and how far it has got; after the deadline, who
// stayed; and sign-ups (paused, or reopened). Every sentence is resolved from the catalog here; the page's components only draw it.
import { englishText } from "@/i18n/text";
import type { CampaignTextCounts } from "@/modules/messaging";
import { deadlineForStaff, type CampaignOverview } from "@/modules/subscriptions";
import { formatCents } from "../alerts/approval/view";
import { languageName } from "../drills/view";
import { formatWhen } from "../texts/view";

/** Where the page is. */
export const CAMPAIGN_PAGE = "/staff/campaign";

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.campaign.${key}`, values);

/** The texts' outcome in one line. */
export const textsLine = (key: "rehearsal.texts" | "running.texts", counts: CampaignTextCounts): string =>
  t(key, { waiting: counts.waiting, handedOff: counts.handedOff, delivered: counts.delivered, notDelivered: counts.notDelivered, unknown: counts.unknown });

/** The page's fixed words, resolved on the server (the body is drawn in the browser too). */
const PAGE_TEXT_KEYS = [
  "title",
  "lead",
  "errors.unreadable",
  "rehearsal.heading",
  "rehearsal.lead",
  "start.heading",
  "start.languagesHeading",
  "running.heading",
  "ended.heading",
  "signups.heading",
] as const;
export type CampaignPageText = Record<(typeof PAGE_TEXT_KEYS)[number], string>;

export function campaignPageText(): CampaignPageText {
  return Object.fromEntries(PAGE_TEXT_KEYS.map((key) => [key, t(key)])) as CampaignPageText;
}

export interface CampaignScreen {
  phase: "not_started" | "running" | "ended";
  rehearsal: {
    roster: string;
    /** Set when the roster is empty: a rehearsal would reach nobody. */
    emptyRoster: string | null;
    /** "Last rehearsal: ..." or "No rehearsal yet." */
    last: string;
    /** Whether "Rehearse on the drill roster" is offered: not while the roster is empty. */
    canRehearse: boolean;
    texts: string | null;
  } | null;
  start: {
    /** The deadline the form carries back (`YYYY-MM-DD`), and in words. */
    deadlineDate: string;
    deadline: string;
    deadlineHint: string;
    asked: string;
    languages: { language: string; subscribers: number }[];
    noSubscribers: string | null;
    cost: string;
    capNotice: string | null;
    what: string;
    textHeading: string;
    text: string;
    /** Set when there is no rehearsal yet: the start is not offered. */
    needsRehearsal: string | null;
  } | null;
  running: { started: string; deadline: string; asked: string; kept: string; texts: string } | null;
  ended: { when: string; kept: string; lapsed: string; purge: string } | null;
  signups: { line: string; hint: string | null; canReopen: boolean };
}

export interface ScreenInput {
  overview: CampaignOverview;
  /** The names of the Admins the overview names (null: the account cannot be read). */
  names: Map<string, string | null>;
  /** What became of the rehearsal's and the campaign's texts. */
  rehearsalTexts: CampaignTextCounts | null;
  campaignTexts: CampaignTextCounts | null;
  /** The cap sentence when starting now would pass the monthly cap (`capNoticeFor`), or null. */
  capNotice: string | null;
}

const nameOf = (names: Map<string, string | null>, id: string | null) => (id === null ? t("someone") : (names.get(id) ?? t("someone")));

export function campaignScreen({ overview, names, rehearsalTexts, campaignTexts, capNotice }: ScreenInput): CampaignScreen {
  const campaign = overview.campaign;
  const phase = campaign === null ? "not_started" : campaign.state === "started" ? "running" : "ended";
  const rehearsal =
    phase === "not_started"
      ? {
          roster: overview.rosterSize === 1 ? t("rehearsal.rosterOne") : t("rehearsal.roster", { n: overview.rosterSize }),
          emptyRoster: overview.rosterSize === 0 ? t("rehearsal.emptyRoster") : null,
          last: overview.rehearsal ? t("rehearsal.last", { when: formatWhen(overview.rehearsal.startedAt), name: nameOf(names, overview.rehearsal.startedBy) }) : t("rehearsal.none"),
          canRehearse: overview.rosterSize > 0,
          texts: overview.rehearsal && rehearsalTexts ? textsLine("rehearsal.texts", rehearsalTexts) : null,
        }
      : null;
  const estimate = overview.estimate;
  const start =
    phase === "not_started"
      ? {
          deadlineDate: overview.deadlineDate,
          deadline: t("start.deadline", { date: deadlineForStaff(overview.deadlineDate) }),
          deadlineHint: t("start.deadlineHint"),
          asked: t("start.asked", { n: estimate.subscribers }),
          languages: estimate.byLanguage.map((row) => ({ language: languageName(row.lang), subscribers: row.subscribers })),
          noSubscribers: estimate.subscribers === 0 ? t("start.noSubscribers") : null,
          cost: t("start.cost", { cost: `${formatCents(estimate.costCents)} CAD`, n: estimate.subscribers }),
          capNotice,
          what: t("start.what"),
          textHeading: t("start.textHeading"),
          text: overview.texts.en.body,
          needsRehearsal: overview.rehearsal === null ? t("start.needsRehearsal") : null,
        }
      : null;
  const running =
    campaign !== null && phase === "running"
      ? {
          started: t("running.started", { when: formatWhen(campaign.startedAt), name: nameOf(names, campaign.startedBy) }),
          deadline: t("running.deadline", { date: deadlineForStaff(campaign.deadlineDate) }),
          asked: t("running.asked", { n: overview.counts.asked }),
          kept: t("running.kept", { n: overview.counts.kept }),
          texts: textsLine("running.texts", campaignTexts ?? { waiting: 0, handedOff: 0, delivered: 0, notDelivered: 0, unknown: 0 }),
        }
      : null;
  const ended =
    campaign !== null && phase === "ended"
      ? {
          when: t("ended.when", { when: formatWhen(campaign.endedAt ?? campaign.startedAt), date: deadlineForStaff(campaign.deadlineDate) }),
          kept: t("ended.kept", { n: overview.counts.kept }),
          lapsed: t("ended.lapsed", { n: overview.counts.lapsed }),
          purge: t("ended.purge"),
        }
      : null;
  const signups =
    campaign === null || campaign.state === "cancelled"
      ? { line: t("signups.open"), hint: null, canReopen: false }
      : campaign.signupsReopenedAt !== null
        ? { line: t("signups.reopened", { when: formatWhen(campaign.signupsReopenedAt), name: nameOf(names, campaign.signupsReopenedBy) }), hint: null, canReopen: false }
        : { line: t("signups.paused"), hint: phase === "ended" ? t("signups.reopenHint") : null, canReopen: phase === "ended" };
  return { phase, rehearsal, start, running, ended, signups };
}

/** The staff ids the overview names, whose names the page reads. */
export function namedStaff(overview: CampaignOverview): string[] {
  return [
    ...new Set([overview.rehearsal?.startedBy, overview.campaign?.startedBy, overview.campaign?.signupsReopenedBy].filter((id): id is string => typeof id === "string")),
  ];
}
