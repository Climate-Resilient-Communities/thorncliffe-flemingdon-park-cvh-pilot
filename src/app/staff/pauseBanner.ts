import { englishText } from "@/i18n/text";
import type { PauseStatus } from "@/modules/messaging";
import { TEXTS_PAGE, pausedBy, pausedWhy } from "./texts/view";

/** What the banner on every Hub screen says while texts are paused. */
export interface PauseBannerView {
  heading: string;
  by: string;
  why: string;
  /** The link that opens the Pause texts page, for the roles that can resume; null for everyone else. */
  resume: { href: string; label: string } | null;
}

export interface PauseBannerDeps {
  status: () => Promise<PauseStatus>;
  nameOf: (staffId: string) => Promise<string | null>;
  /** Whether this viewer may resume texts (the policy action `sending.pause`): they get the link to the page that does. */
  canResume: boolean;
  /** Operational error log (structured, no personal data). */
  logError: (fields: Record<string, string>) => void;
  /** How long the check may take before the screen is shown without the banner (default 2 s). */
  timeoutMs?: number;
}

/** The banner informs and guards nothing (the sender reads the switch itself), so a slow check must never hold a staff screen back. */
export const PAUSE_BANNER_TIMEOUT_MS = 2000;

class BannerTimeout extends Error {
  constructor() {
    super("pause banner check timed out");
    this.name = "BannerTimeout";
  }
}

/**
 * The banner to show above a Hub screen, or null when texts are not paused (S06.06). If the check fails, or takes longer than two seconds,
 * the screen is still shown, without the banner, and the failure is logged by the error's name: the banner informs, it guards nothing.
 * Who paused is a name from identity; a name that cannot be read is "an Admin", so the banner never hides a pause for want of it.
 */
export async function loadPauseBanner(deps: PauseBannerDeps): Promise<PauseBannerView | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new BannerTimeout()), deps.timeoutMs ?? PAUSE_BANNER_TIMEOUT_MS);
    });
    const read = async (): Promise<PauseBannerView | null> => {
      const status = await deps.status();
      if (!status.paused) return null;
      const name = await deps.nameOf(status.pausedBy).catch(() => null);
      return {
        heading: englishText("staff.texts.paused.banner"),
        by: pausedBy(status, name),
        why: pausedWhy(status),
        resume: deps.canResume ? { href: TEXTS_PAGE, label: englishText("staff.texts.paused.resumeLink") } : null,
      };
    };
    return await Promise.race([read(), deadline]);
  } catch (error) {
    deps.logError({ error: error instanceof Error ? error.constructor.name : "unknown" });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function logPauseBannerFailure(fields: Record<string, string>): void {
  console.log(JSON.stringify({ level: "error", evt: "messaging.pause_banner_failed", module: "app", ...fields }));
}
