import type { ListingProvider } from "@/contracts/directory";

// The topics of Find help (R-09), as the prototype has them: needs in the residents' words (catalog `categories.*`), not the
// catalogue's kinds of organisation (UAT 2026-11-04: "the topics did not match"). The catalogue is organised by kind of
// organisation (data/catalogue/providers.json), so each topic is defined here over it: the English subcategory names it takes
// whole (compared as the filters compare them, subcategoryId) and the providers it takes by id, whose listings say they help
// with it though no subcategory does (rent bank, ODSP and benefits help, seniors' programs, counselling).
//
// CONTENT DECISION, machine-drafted from the provider listings on 2026-11-04: the Hub checks and owns this mapping (most of all
// Money and benefits, Seniors and Mental health, which are lists of providers only). A provider id that a release no longer has
// matches nothing; a topic that matches nothing in a release is not offered.

export interface Topic {
  /** The catalog key under `categories` and the filter's id. */
  id: string;
  /** English subcategory names, as in the catalogue's labels. */
  subcategories: readonly string[];
  /** Provider ids. */
  providers: readonly string[];
}

export const TOPICS: readonly Topic[] = [
  { id: "food", subcategories: ["Food Collaboratives", "Food Security & Climate Resilience"], providers: [] },
  { id: "housing", subcategories: ["Housing & Tenant Supports", "Shelter"], providers: ["M022", "M049", "M007"] },
  { id: "health", subcategories: ["Health Clinics", "Dental Clinics", "Midwives Clinic"], providers: [] },
  { id: "money", subcategories: [], providers: ["M022", "M049", "M007", "M060", "M061"] },
  { id: "settlement", subcategories: ["Newcomer Supports"], providers: ["M049", "M007", "M051", "M022", "M080", "M081"] },
  { id: "jobs", subcategories: ["Employment & Skills Training"], providers: ["M049", "M007", "M009", "M050"] },
  { id: "children", subcategories: ["Schools", "Childminding & EarlyON", "Family & Parenting Support"], providers: ["M050", "M009"] },
  { id: "seniors", subcategories: [], providers: ["M049", "M007", "M043", "M045", "M046", "M047", "M069", "M077"] },
  { id: "legal", subcategories: ["Legal Services", "Government Documentation"], providers: ["M022"] },
  { id: "mentalHealth", subcategories: [], providers: ["M045", "M047", "M050", "M089", "M007", "M049"] },
];

const TOPIC_IDS = new Set(TOPICS.map((topic) => topic.id));

export const isTopicId = (id: string): boolean => TOPIC_IDS.has(id);

const subcategoryKey = (english: string) => english.trim().toLocaleLowerCase("en");

/** Whether a provider is in a topic: one of its subcategories, by the English it stands for, or the provider by id. */
export function inTopic(topicId: string, provider: Pick<ListingProvider, "id" | "subcategories">): boolean {
  const topic = TOPICS.find((t) => t.id === topicId);
  if (!topic) return false;
  if (topic.providers.includes(provider.id)) return true;
  const wanted = new Set(topic.subcategories.map(subcategoryKey));
  return provider.subcategories.some((sub) => wanted.has(subcategoryKey(sub.original.body)));
}

/** The topics that hold at least one of `providers`, in the prototype's order. */
export function topicsOf(providers: readonly Pick<ListingProvider, "id" | "subcategories">[]): Topic[] {
  return TOPICS.filter((topic) => providers.some((provider) => inTopic(topic.id, provider)));
}
