import { englishText } from "@/i18n/text";
import { HEALTH_CONDITIONS, SENDER_CONDITIONS, type HealthCondition } from "@/modules/ops";
import { formatWhen } from "./texts/view";

/** What the banner on a Hub screen says while a health condition holds (S06.07 for the sender, S09.01 for every condition). */
export interface HealthBannerView {
  heading: string;
  /** One line per condition that holds, in plain words (and one when the health check itself has stopped), then since when and what to do. */
  lines: string[];
}

/** What the banner is made from: the conditions the health job last found holding, and its heartbeat. */
export interface HealthBannerFacts {
  active: readonly { condition: HealthCondition; since: Date }[];
  /** When the health job last judged every condition (null: never) and whether that was less than 3 minutes ago. */
  heartbeat: { completedAt: Date | null; fresh: boolean };
}

export interface HealthBannerDeps {
  /** ops' `activeHealthConditions` and `readHeartbeat`, one cheap read each. */
  facts: () => Promise<HealthBannerFacts>;
  /**
   * Whether this person sees every condition (S09.01: every Admin and Coordinator screen names each open condition). Everyone else at the Hub
   * (an Ambassador, a Director) sees the banner only when the sender itself is failing, as since S06.07.
   */
  everything: boolean;
  /** Operational error log (structured, no personal data). */
  logError: (fields: Record<string, string>) => void;
  /** How long the check may take before the screen is shown without the banner (default 2 s). */
  timeoutMs?: number;
}

/** The banner informs and guards nothing (the sender and the health job run on their own), so a slow check must never hold a staff screen back. */
export const HEALTH_BANNER_TIMEOUT_MS = 2000;

/** The roles that see every open condition (S09.01): the Admins and Coordinators who run the Hub's alerts. */
export function seesEveryCondition(role: string): boolean {
  return role === "admin" || role === "coordinator";
}

class BannerTimeout extends Error {
  constructor() {
    super("health banner check timed out");
    this.name = "BannerTimeout";
  }
}

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.health.${key}`, values);
const isSender = (condition: HealthCondition) => (SENDER_CONDITIONS as readonly HealthCondition[]).includes(condition);

/**
 * The banner for what holds, or null when nothing does. Each condition is named in plain words, in the order of HEALTH_CONDITIONS; the earliest
 * start is the one named. "Sending is failing" while the sender itself is failing (the texts to the on-call Admins may be late too), else
 * "Something is not working". A health check that ran once and has not completed for 3 minutes is named too, since the banner shows what the
 * last run remembered; one that never ran (a development or preview database) is not.
 */
export function healthBannerView(facts: HealthBannerFacts, options: { everything: boolean }): HealthBannerView | null {
  const shown = HEALTH_CONDITIONS.flatMap((condition) => {
    const row = facts.active.find((candidate) => candidate.condition === condition);
    return row !== undefined && (options.everything || isSender(condition)) ? [row] : [];
  });
  const stale = options.everything && facts.heartbeat.completedAt !== null && !facts.heartbeat.fresh ? facts.heartbeat.completedAt : null;
  if (shown.length === 0 && stale === null) return null;
  const starts = [...shown.map((row) => row.since), ...(stale === null ? [] : [stale])];
  const first = starts.reduce((a, b) => (b < a ? b : a));
  return {
    heading: shown.some((row) => isSender(row.condition)) ? t("banner") : t("bannerOther"),
    lines: [...shown.map((row) => t(row.condition)), ...(stale === null ? [] : [t("stale")]), t("since", { when: formatWhen(first) }), t("tell")],
  };
}

/**
 * The banner to show above a Hub screen while a health condition holds (S06.07: "if the sender itself is failing, the `ops_event` and the Hub
 * banner still record it"; S09.01: every open condition on every Admin and Coordinator screen, until it clears), from what the health job
 * remembers. If the check fails, or takes longer than two seconds, the screen is shown without the banner and the failure is logged by the
 * error's name.
 */
export async function loadHealthBanner(deps: HealthBannerDeps): Promise<HealthBannerView | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new BannerTimeout()), deps.timeoutMs ?? HEALTH_BANNER_TIMEOUT_MS);
    });
    return await Promise.race([deps.facts().then((facts) => healthBannerView(facts, { everything: deps.everything })), deadline]);
  } catch (error) {
    deps.logError({ error: error instanceof Error ? error.constructor.name : "unknown" });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function logHealthBannerFailure(fields: Record<string, string>): void {
  console.log(JSON.stringify({ level: "error", evt: "health.banner_failed", module: "app", ...fields }));
}
