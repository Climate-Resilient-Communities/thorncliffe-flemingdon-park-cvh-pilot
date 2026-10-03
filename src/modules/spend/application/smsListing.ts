// The listing of one reconciliation (S06.08): the provider's Messages API read page after page through a port, following `next_page_uri`
// until it is empty. It is COMPLETE only when it ended by itself; otherwise it says why it could not finish, and the reconciliation is
// pending (nothing is recorded from a listing that did not complete, and the next run reads it again from the start):
//  - `listing_failed`: the first page or a next page could not be read (an error, a refusal, an answer that is not a page), or the next
//    pages came round to one already read (a listing that would never end);
//  - `cut_short`: the page limit or the time limit of one run was reached while the provider still named a next page.
import type { ProviderMessage } from "../domain/smsActuals";
import type { ReconciliationInterval } from "../domain/reconciliation";

export type { ProviderMessage };

export interface MessagePage {
  messages: ProviderMessage[];
  /** The provider's `next_page_uri`, or null when this is the last page. */
  nextPageUri: string | null;
}

/**
 * Port: the provider's Messages API, listed. `first` asks for the messages sent between two instants (the adapter may widen the request;
 * the reconciliation keeps only the messages sent in its exact interval) and `next` follows a `next_page_uri` exactly as the previous page
 * gave it. Either throws when the provider cannot be read (an error, a refusal, an answer that is not a page): the listing is then failed.
 */
export interface SmsMessageLister {
  first(range: { startUtc: Date; endUtc: Date }): Promise<MessagePage>;
  next(nextPageUri: string): Promise<MessagePage>;
}

export interface ListingLimits {
  /** The most pages one run reads (default 200, of up to 1,000 messages each). */
  maxPages: number;
  /** How long one run lists for before it stops with the listing cut short (default 45 seconds). */
  deadlineMs: number;
}

export type Listing = { kind: "complete"; messages: ProviderMessage[]; pages: number } | { kind: "pending"; reason: "listing_failed" | "cut_short"; pages: number };

const nameOf = (error: unknown) => (error instanceof Error ? error.name : "NonError");

/** Lists the interval's messages until `next_page_uri` is empty, or says why it could not. `onFailure` is told the error's name only (a log line); it never carries a message. */
export async function listMessages(
  lister: SmsMessageLister,
  interval: ReconciliationInterval,
  options: { now(): Date; limits: ListingLimits; onFailure?(what: { reason: "listing_failed" | "cut_short"; page: number; error: string }): void },
): Promise<Listing> {
  const startedAt = options.now().getTime();
  const messages: ProviderMessage[] = [];
  const seen = new Set<string>();
  const fail = (reason: "listing_failed" | "cut_short", pages: number, error: string): Listing => {
    options.onFailure?.({ reason, page: pages, error });
    return { kind: "pending", reason, pages };
  };

  let page: MessagePage;
  try {
    page = await lister.first({ startUtc: interval.startUtc, endUtc: interval.endUtc });
  } catch (error) {
    return fail("listing_failed", 1, nameOf(error));
  }
  let pages = 1;
  messages.push(...page.messages);
  while (page.nextPageUri !== null && page.nextPageUri !== "") {
    // The page limit and the time limit of one run: the listing is cut short, not complete, whatever it read.
    if (pages >= options.limits.maxPages || options.now().getTime() - startedAt >= options.limits.deadlineMs) return fail("cut_short", pages, "ListingLimit");
    // A next page the listing already visited would never end.
    if (seen.has(page.nextPageUri)) return fail("listing_failed", pages + 1, "NextPageLoop");
    seen.add(page.nextPageUri);
    try {
      page = await lister.next(page.nextPageUri);
    } catch (error) {
      return fail("listing_failed", pages + 1, nameOf(error));
    }
    pages += 1;
    messages.push(...page.messages);
  }
  return { kind: "complete", messages, pages };
}
