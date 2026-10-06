// The sign-up gate of the end-of-pilot campaign (S09.07): sign-ups are paused from the real campaign's start until an Admin reopens them for the MVP.
// Every path that makes a pending sign-up or a subscriber asks here: the web form and the staff-assisted sign-up (webSignup.ts) and a YES that confirms a
// pending sign-up (inbound.ts). Each holds the gate shared in its own transaction while it writes, and the campaign's start holds it exclusively while it
// deletes the pending sign-ups and asks every active subscriber, so neither commits a sign-up the other did not see.
import type { DbExecutor, DbTransaction } from "../../../platform/db";
import { campaignStore, type CampaignStore } from "../adapters/campaignStore";

/**
 * Whether sign-ups are open: `closed` is read before anything is counted; `holdOpen` runs in the writing transaction (after the number's lock), takes the
 * gate the campaign's start takes exclusively (so one waits for the other) and answers whether sign-ups are still open.
 */
export interface SignupGate {
  closed(executor: DbExecutor): Promise<boolean>;
  holdOpen(tx: DbTransaction): Promise<boolean>;
}

export function createSignupGate(store: Pick<CampaignStore, "signupsClosed" | "lockSignupsShared"> = campaignStore): SignupGate {
  return {
    closed: (executor) => store.signupsClosed(executor),
    async holdOpen(tx) {
      await store.lockSignupsShared(tx);
      return !(await store.signupsClosed(tx));
    },
  };
}

/** The gate on the campaign table. */
export const campaignSignupGate: SignupGate = createSignupGate();

/** Sign-ups always open (tests of a sign-up that is not about the campaign). */
export const signupsAlwaysOpen: SignupGate = { closed: async () => false, holdOpen: async () => true };
