import { englishText } from "@/i18n/text";
import { SENDER_CONDITIONS } from "@/modules/ops";
import { formatWhen } from "./texts/view";

type SenderCondition = (typeof SENDER_CONDITIONS)[number];

/** What the banner on every Hub screen says while the sender itself is failing (S06.07). */
export interface SenderBannerView {
  heading: string;
  /** One line per condition that holds (texts stuck in the queue; no sender running), then when it began and what to do. */
  lines: string[];
}

export interface SenderBannerDeps {
  /** The sender conditions the health job last found holding (ops' `activeSenderConditions`). */
  active: () => Promise<readonly { condition: SenderCondition; since: Date }[]>;
  /** Operational error log (structured, no personal data). */
  logError: (fields: Record<string, string>) => void;
  /** How long the check may take before the screen is shown without the banner (default 2 s). */
  timeoutMs?: number;
}

/** The banner informs and guards nothing (the sender and the health job run on their own), so a slow check must never hold a staff screen back. */
export const SENDER_BANNER_TIMEOUT_MS = 2000;

class BannerTimeout extends Error {
  constructor() {
    super("sender banner check timed out");
    this.name = "BannerTimeout";
  }
}

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.health.${key}`, values);

/** The banner for the conditions that hold, or null when none does. The earliest start is the one named. */
export function senderBannerView(active: readonly { condition: SenderCondition; since: Date }[]): SenderBannerView | null {
  if (active.length === 0) return null;
  const first = active.reduce((a, b) => (b.since < a.since ? b : a));
  return {
    heading: t("banner"),
    lines: [...SENDER_CONDITIONS.filter((condition) => active.some((row) => row.condition === condition)).map((condition) => t(condition)), t("since", { when: formatWhen(first.since) }), t("tell")],
  };
}

/**
 * The banner to show above a Hub screen while the sender is failing (S06.07: "if the sender itself is failing, the `ops_event` and the Hub banner
 * still record it"), from what the health job remembers (one cheap read). If the check fails, or takes longer than two seconds, the screen is
 * shown without the banner and the failure is logged by the error's name.
 */
export async function loadSenderBanner(deps: SenderBannerDeps): Promise<SenderBannerView | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new BannerTimeout()), deps.timeoutMs ?? SENDER_BANNER_TIMEOUT_MS);
    });
    return await Promise.race([deps.active().then(senderBannerView), deadline]);
  } catch (error) {
    deps.logError({ error: error instanceof Error ? error.constructor.name : "unknown" });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function logSenderBannerFailure(fields: Record<string, string>): void {
  console.log(JSON.stringify({ level: "error", evt: "health.sender_banner_failed", module: "app", ...fields }));
}
