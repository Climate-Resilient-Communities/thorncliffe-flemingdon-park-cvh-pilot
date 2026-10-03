// Which providers' descriptions keep human review (product owner, decision 42, 2026-10-03): under the AD-11 pilot change
// a description may ship as an unreviewed machine translation, except for a provider that
//  (a) has an emergency role (`emergencyRole` in providers.json), or
//  (b) is in the category "Support & Emergency Services", or
//  (c) whose English description names a crisis or emergency line (safetyCriticalTerms in src/contracts/contentReview.ts).
// Such a description shows in English with translation.unavailable until its translation is `reviewed` (reason
// `safety_critical`). Decided on the English and the catalogue's own fields, never on a translation. Pure; the seed
// (providerCatalogue.ts) and the release (directoryRelease.ts) both apply it.
import { present, safetyCriticalTerms } from "@/contracts/contentReview";

/** The categories whose providers are safety-critical, by their English name in providers.json `labels.categories`. */
export const SAFETY_CRITICAL_CATEGORIES: readonly string[] = ["Support & Emergency Services"];

export type SafetyCriterion = "emergency_role" | "emergency_category" | "crisis_text";

/** Why a provider's description keeps human review; empty when it may ship as an unreviewed machine translation. */
export function safetyCriteria(provider: { services: string; emergencyRole?: string | null; categoryNames: readonly string[] }): SafetyCriterion[] {
  const criteria: SafetyCriterion[] = [];
  if (present(provider.emergencyRole)) criteria.push("emergency_role");
  if (provider.categoryNames.some((name) => SAFETY_CRITICAL_CATEGORIES.includes(name))) criteria.push("emergency_category");
  if (safetyCriticalTerms(provider.services).length > 0) criteria.push("crisis_text");
  return criteria;
}
