import { UsageEventSchema, USAGE_PATH, type UsageEvent } from "@/contracts/usage";

// Sending a usage event (S02.15, AR-26): one small POST of exactly `{evt, lang, nbhd?}`. Nothing is added to it and nothing
// that identifies the phone goes with it: no cookie, no credentials, no referrer (the address of the page could name a
// building), and the body is rebuilt from the three allowed fields so a caller cannot slip another one in. It is never
// queued: without signal the event is dropped (counts are approximate by design), and a failure is not retried. It never
// throws and never makes the page wait.

export interface SendDeps {
  fetcher?: typeof fetch;
  /** Whether the phone says it has signal. */
  online?: () => boolean;
  /** Give up after this many milliseconds (default 5000), so a hung request neither holds the page nor the install flag. */
  timeoutMs?: number;
  /** Let the request outlive the page (one small request only, used for the install event). */
  keepalive?: boolean;
}

const phoneOnline = (): boolean => typeof navigator === "undefined" || navigator.onLine !== false;

/** The event as it goes out: the three allowed fields, `nbhd` only when there is one. */
export function usageBody(event: UsageEvent): string {
  const checked = UsageEventSchema.parse(event);
  return JSON.stringify(checked.nbhd === undefined ? { evt: checked.evt, lang: checked.lang } : { evt: checked.evt, lang: checked.lang, nbhd: checked.nbhd });
}

/** Sends the event. Resolves to true when the server counted it, false when it was dropped or failed. */
export async function sendUsage(event: UsageEvent, deps: SendDeps = {}): Promise<boolean> {
  const online = deps.online ?? phoneOnline;
  if (!online()) return false;
  try {
    const body = usageBody(event);
    const response = await (deps.fetcher ?? fetch)(USAGE_PATH, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(deps.timeoutMs ?? 5000),
      ...(deps.keepalive ? { keepalive: true } : {}),
    });
    // The body (an error answer has one) is always read, so a refusal does not leave the request open.
    await response.text().catch(() => "");
    return response.ok;
  } catch {
    return false;
  }
}
