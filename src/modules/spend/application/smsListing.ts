// The listing of one reconciliation (S06.08): the provider's Messages API read page after page through a port, following `next_page_uri`
// until it is empty. It is COMPLETE only when it ended by itself; otherwise it says why it could not finish, and the reconciliation is
// pending (nothing is recorded from a listing that did not complete, and the next run reads it again from the start):
//  - `listing_failed`: the first page or a next page could not be read (an error, a refusal, an answer that is not a page), or the next
//    pages came round to one already read (a listing that would never end);
//  - `cut_short`: the page limit or the time limit of one run was reached while the provider still named a next page. The time limit is
//    the whole run's, not one month's: a run that reconciles several months gives each listing the same deadline (`deadlineAt`), each page
//    is asked for no longer than the time left, and a month whose turn comes after the time is spent is cut short without being asked for.
import type { ProviderMessage } from "../domain/smsActuals";
import type { ReconciliationInterval } from "../domain/reconciliation";

export type { ProviderMessage };

export interface MessagePage {
  messages: ProviderMessage[];
  /** The provider's `next_page_uri`, or null when this is the last page. */
  nextPageUri: string | null;
}

/** What a caller asks of one request to the provider. */
export interface ListOptions {
  /** The longest to wait for this page, in milliseconds: the time left in the run. An adapter never waits longer than its own limit either, whichever is less. */
  timeoutMs?: number;
}

/**
 * Port: the provider's Messages API, listed. `first` asks for the messages sent between two instants (the adapter may widen the request;
 * the reconciliation keeps only the messages sent in its exact interval) and `next` follows a `next_page_uri` exactly as the previous page
 * gave it. Either throws when the provider cannot be read (an error, a refusal, an answer that is not a page): the listing is then failed.
 */
export interface SmsMessageLister {
  first(range: { startUtc: Date; endUtc: Date }, options?: ListOptions): Promise<MessagePage>;
  next(nextPageUri: string, options?: ListOptions): Promise<MessagePage>;
}

export interface ListingLimits {
  /** The most pages one run reads (default 200, of up to 1,000 messages each). */
  maxPages: number;
  /** How long one run lists for, in all, before it stops with the listing cut short (default 45 seconds). A run of several months shares it. */
  deadlineMs: number;
}

export type Listing = { kind: "complete"; messages: ProviderMessage[]; pages: number } | { kind: "pending"; reason: "listing_failed" | "cut_short"; pages: number };

const nameOf = (error: unknown) => (error instanceof Error ? error.name : "NonError");

/**
 * Lists the interval's messages until `next_page_uri` is empty, or says why it could not. `onFailure` is told the error's name only (a log
 * line); it never carries a message. The run's time ends at `deadlineAt` (default: `limits.deadlineMs` after the call): a listing that
 * starts after it, or reaches it between pages, is cut short; each page is asked for no longer than the time left, and a page that fails
 * once the time is spent is the time limit, not a failed listing.
 */
export async function listMessages(
  lister: SmsMessageLister,
  interval: ReconciliationInterval,
  options: { now(): Date; limits: ListingLimits; deadlineAt?: Date; onFailure?(what: { reason: "listing_failed" | "cut_short"; page: number; error: string }): void },
): Promise<Listing> {
  const startedAt = options.now().getTime();
  const deadlineAt = options.deadlineAt?.getTime() ?? startedAt + options.limits.deadlineMs;
  const messages: ProviderMessage[] = [];
  const seen = new Set<string>();
  const fail = (reason: "listing_failed" | "cut_short", pages: number, error: string): Listing => {
    options.onFailure?.({ reason, page: pages, error });
    return { kind: "pending", reason, pages };
  };
  /** What a request that threw is: the run's time limit when the time is spent by now, a failed listing when it is not. */
  const threw = (pages: number, error: string): Listing => fail(options.now().getTime() >= deadlineAt ? "cut_short" : "listing_failed", pages, error);
  const timeLeft = (): ListOptions => ({ timeoutMs: Math.max(deadlineAt - options.now().getTime(), 1) });

  // A run whose time is already spent (an earlier month used it) asks for nothing.
  if (startedAt >= deadlineAt) return fail("cut_short", 0, "ListingLimit");

  let page: MessagePage;
  try {
    page = await lister.first({ startUtc: interval.startUtc, endUtc: interval.endUtc }, timeLeft());
  } catch (error) {
    return threw(1, nameOf(error));
  }
  let pages = 1;
  messages.push(...page.messages);
  while (page.nextPageUri !== null && page.nextPageUri !== "") {
    // The page limit and the time limit of one run: the listing is cut short, not complete, whatever it read.
    if (pages >= options.limits.maxPages || options.now().getTime() >= deadlineAt) return fail("cut_short", pages, "ListingLimit");
    // A next page the listing already visited would never end.
    if (seen.has(page.nextPageUri)) return fail("listing_failed", pages + 1, "NextPageLoop");
    seen.add(page.nextPageUri);
    try {
      page = await lister.next(page.nextPageUri, timeLeft());
    } catch (error) {
      return threw(pages + 1, nameOf(error));
    }
    pages += 1;
    messages.push(...page.messages);
  }
  return { kind: "complete", messages, pages };
}
