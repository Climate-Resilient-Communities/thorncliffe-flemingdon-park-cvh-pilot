// Composition root of the text messages' spend seams (S06.08, AD-2, AD-8): the dispatcher's and the status callbacks' hooks that write a
// text's estimate to `spend_event` in the transaction that records its outcome, and run the matching rule when a provider id is recorded
// later. The price per segment comes from the validated environment (SMS_PRICE_PER_SEGMENT_CENTS). The same hooks are given to
// `appDispatcher` and to `appStatusCallbacks`, because the callback that moves a `claimed` row is the first record that the provider
// accepted the text, and the estimate is written there by the same function, once. Server only.
import "server-only";
import { createSmsSpend, type SmsSpendHooks } from "@/modules/messaging";
import { getEnv, type Env } from "@/platform/config/env";

/** The spend hooks on the real environment (a price that is not valid throws here, at start-up of the sender, not in the middle of an outcome). */
export function appSmsSpend(env: Pick<Env, "smsPricePerSegmentCents"> = getEnv()): SmsSpendHooks {
  return createSmsSpend({ pricePerSegmentCents: env.smsPricePerSegmentCents });
}
