// An in-memory SmsProvider for tests: records every text it is asked to send and answers as told.
// It makes no network call, ever. The default answer is Twilio's "queued" with a fake message id.
import type { OutboundText, ProviderAnswer, SmsProvider } from "../application/ports";

export const FAKE_MESSAGE_SID = `SM${"0123456789abcdef".repeat(2)}`;

export interface FakeSms extends SmsProvider {
  /** Every text the provider was asked to send, in order. */
  readonly sent: OutboundText[];
  /** Changes the answer to the next calls. */
  answer(next: ProviderAnswer | (() => Promise<ProviderAnswer>)): void;
}

export function fakeSms(initial?: ProviderAnswer | (() => Promise<ProviderAnswer>)): FakeSms {
  let current: ProviderAnswer | (() => Promise<ProviderAnswer>) = initial ?? { kind: "accepted", httpStatus: 201, status: "queued", messageId: FAKE_MESSAGE_SID };
  const sent: OutboundText[] = [];
  return {
    sent,
    answer(next) {
      current = next;
    },
    async send(text) {
      sent.push(text);
      return typeof current === "function" ? current() : current;
    },
  };
}
