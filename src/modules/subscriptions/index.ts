// The subscriptions module's import surface. Today it holds the terms (S07.01): `subscriber.consent_version`
// is the terms version a sign-up accepted, so the consent text belongs here (spine AD-9).
import { termsService } from "./adapters/bundledTerms";

export { readTermsCatalogue } from "./adapters/termsFiles";
export { bundledTermsInput } from "./adapters/bundledTerms";
export {
  createTermsService,
  signupConsentVersion,
  termsPageMode,
  type DraftTerms,
  type PublishedTerms,
  type TermsPageMode,
  type TermsService,
  type TermsView,
} from "./application/termsService";
export {
  NEW_VERSION_APPLIES_TO,
  REQUIRED_FACTS,
  REQUIRED_SECTIONS,
  formatTermsReport,
  planTerms,
  termsReviewHash,
  termsTexts,
  versionToRecord,
  type TermsDocument,
  type TermsInput,
  type TermsPlan,
  type TermsText,
} from "./domain/terms";

/** The published consent_version and text in a language, or null when nothing is published (a sign-up must then refuse). */
export const currentPublishedTerms = termsService.currentPublishedTerms;
/** The published consent_version, or null. */
export const currentConsentVersion = termsService.currentConsentVersion;
/** What /{lang}/terms shows: the published terms, or the draft and why it is not published. */
export const termsPageView = termsService.termsPageView;

export {
  DEFAULT_RATE_LIMIT_TIMEOUT_MS,
  RATE_LIMIT_RETENTION_MS,
  SEARCH_RATE_LIMIT,
  clientHash,
  createRateLimiter,
  normaliseClientAddress,
  rateLimitKeyFromSecret,
  type RateLimitRule,
  type RateLimiter,
} from "./application/rateLimit";

// The approval's recipient-count and snapshot port (S04.07; S07.07 made it the real subscriber fan-out).
export { captureRecipients, countRecipients, recipientsPort, type AlertRecipient, type RecipientCount, type RecipientEntry, type RecipientSmsBody, type RecipientsPort } from "./application/recipients";

// The web sign-up (S07.02): the use case, the pending sign-up's number source for the ContactResolver, and the seam that forgets a sign-up
// whose confirmation was refused because the number texted STOP. S07.03 adds `assist`, the staff-assisted sign-up, to the same use case.
export {
  ASSISTED_SIGNUP_RATE_LIMIT,
  ConfirmationNotQueued,
  SIGNUP_RATE_LIMIT,
  TWILIO_OPTED_OUT_ERROR,
  confirmationText,
  createSignup,
  forgetOptedOutSignup,
  pendingSignupNumberSource,
  type AssistedSignupAudit,
  type Signup,
  type SignupChannel,
  type SignupDeps,
  type SignupOutcome,
  type SignupPlaces,
  type SubscriberLookup,
} from "./application/webSignup";
// The inbound router (S07.04): YES confirms a pending sign-up (the subscriber and its welcome), STOP and a confirmed reply 0 delete everything
// held for the number, the webhook's signature check, the ContactResolver's sources for subscribers and `inbound_reply` rows, and the web
// sign-up's real "already subscribed" lookup.
export {
  ReplyNotQueued,
  SIGNUP_INFO_SCOPE,
  createInboundRouter,
  inboundReplyNumberSource,
  noCheckinsYet,
  noMenusYet,
  residentSms,
  signupLink,
  subscriberLookup,
  subscriberNumberSource,
  subscriberReceives,
  yesWordsFor,
  type CheckinCleanup,
  type Deleted,
  type InboundDeps,
  type InboundLog,
  type InboundMessage,
  type InboundOutcome,
  type InboundRouter,
  type MenuPort,
} from "./application/inbound";
export { createInboundWebhook, type InboundRequest, type InboundResult, type InboundWebhook, type InboundWebhookDeps, type SignatureRefusal } from "./application/inboundWebhook";
export {
  DELETE_CONFIRM_MS,
  INBOUND_KEYWORDS,
  INBOUND_PATH,
  decide,
  normaliseReply,
  readKeyword,
  type Decision,
  type InboundAction,
  type InboundKeyword,
  type NumberState,
} from "./domain/inbound";
// S06.05: the drill roster, the staff phones a drill is texted on (composed in src/app/drills.ts), and the ContactResolver's source for `roster` recipients.
export {
  createDrillRoster,
  drillNumberSource,
  type AddOutcome as DrillRosterAddOutcome,
  type DrillMember,
  type DrillRoster,
  type DrillRosterDeps,
  type DrillRosterEntry,
  type EditOutcome as DrillRosterEditOutcome,
  type RemoveOutcome as DrillRosterRemoveOutcome,
} from "./application/drillRoster";
export { DRILL_LABEL_MAX_CHARS, DRILL_ROSTER_MAX, bodyLangOf, parseRosterLabel, parseRosterLang, parseRosterNumber, type DrillRosterRefusal } from "./domain/drillRoster";

// S07.10: the daily subscriber measures (FR-M1 subscribers) and the Hub's reading of them: counts by language and neighbourhood, the small-number rule applied by the view.
export { createSubscriberMeasuresJob, readSubscriberMeasures, type SubscriberMeasuresJob, type SubscriberMeasuresReport } from "./application/subscriberMeasures";
export {
  FEWER_THAN_FIVE as SUBSCRIBER_FEWER_THAN_FIVE,
  NOT_SHOWN as SUBSCRIBER_NOT_SHOWN,
  SUBSCRIBER_LANGS,
  SUBSCRIBER_MEASURES,
  type MeasureReading,
  type MeasuredDay,
  type ShownCount,
  type SubscriberMeasure,
  type SubscriberMeasuresDay,
} from "./domain/subscriberMeasures";

// S09.07: the end-of-pilot re-consent campaign (composed in src/app/campaign.ts): its rehearsal on the drill roster, the start, reopening sign-ups, the end job,
// the sender's check of a campaign text at the hand-off point, and the one condition of who receives texts (`receivingSql`; `lapsedSql` is whom S09.08's purge
// deletes).
export {
  campaignStandingReader,
  createCampaigns,
  renderCampaignText,
  type CampaignAudit,
  type CampaignDeps,
  type CampaignOverview,
  type CampaignSpendCap,
  type CampaignSummary,
  type Campaigns,
  type EndReport as CampaignEndReport,
  type ReopenOutcome as CampaignReopenOutcome,
  type RehearseOutcome as CampaignRehearseOutcome,
  type StartInput as CampaignStartInput,
  type StartOutcome as CampaignStartOutcome,
} from "./application/campaign";
export { campaignSignupGate, createSignupGate, signupsAlwaysOpen, type SignupGate } from "./application/campaignGate";
export { lapsedSql, receivingSql } from "./adapters/campaignStore";
export {
  CAMPAIGN_REFUSALS,
  RECONSENT_DAYS,
  RECONSENT_PROMPT_KIND,
  RECONSENT_PURPOSE,
  deadlineForStaff,
  deadlineInText,
  estimateCampaign,
  isDeadlineDate,
  type CampaignEstimate,
  type CampaignRefusal,
  type CampaignState,
  type CampaignTexts,
} from "./domain/campaign";

// S09.08: the end-of-pilot purge (composed in src/app/purge.ts, run by /api/jobs/end-of-pilot-purge): every subscriber still asked after the deadline deleted
// with the E07 deletion (the inbound router's `SubscriberDeletion`), the completion recorded once, and the day it completed for the terms page.
export { PURGE_BUDGET_MS, PURGE_PAGE, createEndOfPilotPurge, residentDataDeletedOn, type EndOfPilotPurge, type PurgeDeps, type PurgeLog, type PurgeReport } from "./application/purge";
export type { SubscriberDeletion } from "./application/inbound";
