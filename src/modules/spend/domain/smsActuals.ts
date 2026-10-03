// From a provider's listing to the actual prices a reconciliation records (S06.08, AD-8). Pure.
//
// A listing is applied only when every outbound message of the exact interval can be recorded: it must have an id and the instant it was
// sent, and a price this app can convert. One that cannot makes the whole reconciliation pending (nothing from it is recorded), and the
// reason says which kind of problem it was. A message sent outside the interval is not this reconciliation's (the provider's date filter is
// wider than the interval, and the message belongs to the reconciliation whose interval holds it), and inbound messages are not texts the
// app sent. A message the listing gives twice (the list moved while it was read) is one message.
import type { PendingReason, ReconciliationInterval } from "./reconciliation";
import { toCadMillicents } from "./smsPrice";

/** One message of the provider's listing, as far as a reconciliation reads it. Never a number or a body. */
export interface ProviderMessage {
  /** The provider's id for the message (`SM…`, or `MM…` for a media message). */
  sid: string;
  /** `inbound`, `outbound-api`, `outbound-call`, `outbound-reply`. Only outbound messages are the app's cost. */
  direction: string;
  /** When the provider sent it; null for a message that has not been sent. */
  dateSent: Date | null;
  /** The price as the provider reports it ("-0.00790"), or null until it is priced. */
  price: string | null;
  /** The currency of the price ("USD"). */
  priceUnit: string | null;
  /**
   * The message's status as the provider reports it (`delivered`, `failed`, `canceled`, ...): a code, never personal data. The listing keeps it
   * now so that a decision about messages the provider never prices (a failed or canceled one) needs no change to the adapter; nothing reads it yet.
   */
  status?: string | null;
}

/** One message's price as it is recorded: what the provider reported, the rate it was converted at, and the CAD amount in thousandths of a cent. */
export interface ActualInput {
  messageSid: string;
  sentAt: Date;
  priceText: string;
  priceUnit: string;
  rate: number;
  cadMillicents: number;
}

export type ActualsResult = { kind: "ok"; actuals: ActualInput[]; outsideInterval: number } | { kind: "pending"; reason: PendingReason };

const MESSAGE_SID = /^(SM|MM)[0-9a-f]{32}$/;

/** The messages of the listing that are the app's outbound texts: the rest of the provider's account is not its cost. */
export const isOutbound = (message: ProviderMessage): boolean => message.direction.toLowerCase().startsWith("outbound");

/**
 * The outbound messages of the exact interval `[start, end)` as actuals, converted to CAD at `usdToCad`; or the reason the listing cannot be
 * applied. When several kinds of problem are present the reason is the first of: `message_malformed`, `message_without_price`, `price_unusable`.
 */
export function toActuals(interval: ReconciliationInterval, listed: readonly ProviderMessage[], usdToCad: number): ActualsResult {
  const problems = new Set<PendingReason>();
  const bySid = new Map<string, ActualInput>();
  let outsideInterval = 0;
  for (const message of listed) {
    if (!isOutbound(message)) continue;
    if (!MESSAGE_SID.test(message.sid) || message.dateSent === null || Number.isNaN(message.dateSent.getTime())) {
      problems.add("message_malformed");
      continue;
    }
    if (message.dateSent < interval.startUtc || message.dateSent >= interval.endUtc) {
      outsideInterval += 1;
      continue;
    }
    const price = toCadMillicents(message.price, message.priceUnit, usdToCad);
    if (!price.ok) {
      problems.add(price.reason === "no_price" ? "message_without_price" : "price_unusable");
      continue;
    }
    if (!bySid.has(message.sid)) {
      bySid.set(message.sid, { messageSid: message.sid, sentAt: message.dateSent, priceText: price.priceText, priceUnit: price.unit, rate: price.rate, cadMillicents: price.millicents });
    }
  }
  for (const reason of ["message_malformed", "message_without_price", "price_unusable"] as const) {
    if (problems.has(reason)) return { kind: "pending", reason };
  }
  return { kind: "ok", actuals: [...bySid.values()], outsideInterval };
}
