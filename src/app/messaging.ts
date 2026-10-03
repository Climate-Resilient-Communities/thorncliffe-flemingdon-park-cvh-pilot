// Composition root of the messaging module's ContactResolver port (AD-2, AD-8): the dispatcher asks for a recipient's phone
// number at the hand-off point and never stores it. messaging holds no numbers and may not import the modules that do, so each
// module that owns recipients gives a number source and this file wires them: `subscriptions` (subscribers, pending sign-ups,
// the drill roster and the short-lived `inbound_reply` rows), `identity` (staff) and `ops` (the on-call roster). Server only.
//
// `ownerSources()` is where each module's source is added by the story that creates its table (S06.05 the drill roster, S06.07
// the on-call roster, S07.02 pending sign-ups, S07.04 subscribers and `inbound_reply`); until then a kind with no source
// fails loudly (`ContactSourceNotWired`) instead of skipping its texts.
import "server-only";
import {
  RECIPIENT_KINDS,
  RECIPIENT_OWNER,
  createContactResolver,
  stdoutMessagingLog,
  type ContactResolver,
  type MessagingLog,
  type RecipientKind,
  type RecipientNumberSource,
  type RecipientNumberSources,
} from "@/modules/messaging";

/** The recipient kinds whose numbers `subscriptions` holds. */
export type SubscriptionsRecipientKind = { [K in RecipientKind]: (typeof RECIPIENT_OWNER)[K] extends "subscriptions" ? K : never }[RecipientKind];

/** What each owner module gives the resolver: a number source per kind of recipient it owns. */
export interface OwnerNumberSources {
  subscriptions?: Partial<Record<SubscriptionsRecipientKind, RecipientNumberSource>>;
  /** `staff` recipients: the active staff accounts. */
  identity?: RecipientNumberSource;
  /** `oncall` recipients: the numbers on `ops.oncall_roster`. */
  ops?: RecipientNumberSource;
}

/** The source of each kind of recipient, taken from the module that owns the kind (RECIPIENT_OWNER). */
export function wireContactSources(owners: OwnerNumberSources): RecipientNumberSources {
  const sources: RecipientNumberSources = {};
  for (const kind of RECIPIENT_KINDS) {
    const owner = RECIPIENT_OWNER[kind];
    const source = owner === "subscriptions" ? owners.subscriptions?.[kind as SubscriptionsRecipientKind] : owners[owner];
    if (source) sources[kind] = source;
  }
  return sources;
}

/** The ContactResolver for the given owner sources; the log shows numbers only masked to their last two digits. */
export function wireContactResolver(owners: OwnerNumberSources, log: MessagingLog = stdoutMessagingLog): ContactResolver {
  return createContactResolver({ sources: wireContactSources(owners), log });
}

/** The sources the owner modules provide today: none yet (see the header). */
function ownerSources(): OwnerNumberSources {
  return {};
}

let resolver: ContactResolver | undefined;

/** The ContactResolver the dispatcher uses (S06.02). */
export function contactResolver(): ContactResolver {
  return (resolver ??= wireContactResolver(ownerSources()));
}

/** Test seam: forget the composition. */
export function resetMessagingComposition(): void {
  resolver = undefined;
}
