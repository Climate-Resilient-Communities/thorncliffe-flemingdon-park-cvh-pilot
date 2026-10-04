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

// The approval's recipient-count and snapshot port (S04.07): empty until E07 opens text sign-up.
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
  noSubscribersYet,
  pendingSignupNumberSource,
  type AssistedSignupAudit,
  type Signup,
  type SignupChannel,
  type SignupDeps,
  type SignupOutcome,
  type SignupPlaces,
  type SubscriberLookup,
} from "./application/webSignup";
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
