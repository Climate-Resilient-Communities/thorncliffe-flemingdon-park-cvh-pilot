// The keyword half of search's ranking (interim tuning, 2026-10-07; data/search-test-set/reports/2026-10-07-interim-tuning.md).
// Pure and deterministic: no dependency, no model, no vendor call.
//
// A question's words are matched against each provider's English name, category names, subcategory names and services text
// with BM25 (k1 = 1.2, b = 0.75). The index is built once per release, when its search data is loaded, from the English listing
// file the search already reads (no other file, nothing stored). The tokenizer is plain: lower case, runs of the letters a to z,
// a short list of English stop words dropped, a plural `s` (and `ies` to `y`) taken off. A text with no English words (any other
// script) has no tokens and gets no boost.
//
// The ranking adds `weight × bm25 / (bm25 + KEYWORD_SATURATION)` to a provider's similarity (searchRanking.ts), so the words'
// boost is at most `weight` however many words match. Only English text is matched: an English question, and the English translation of
// the translated-question leg.
//
// Besides words, a text can hold a concept (CONCEPTS): a need that residents and listings put in different words, such as
// learning English ("where can I learn english", "English classes") and the listings' "ESL", "LINC" or "language training". A
// concept is one more token, with a name no word can have, found by phrase in the question and in the listing alike; it is not
// one of BM25's words: a provider that holds a concept the question names gets `weight` once more, so the most the keyword
// match adds is twice `weight` (production UAT, 2026-10-08: "where can I learn english" showed childcare centres, whose
// listings say care is offered "in English", and missed the LINC and ESL classes). A listing that says it does not offer the
// thing ("no French immersion, ESL, or special education programs were listed") does not hold the concept.
// Words of language names that only list the languages a service is offered in ("Care offered in English, Spanish and
// Gujarati", "staff (English, Arabic, French …)") are not read as words: they say what language the help is in, not what it is.

/** BM25's term-frequency saturation and length normalisation. */
const K1 = 1.2;
const B = 0.75;
/** The boost is `weight × bm25 / (bm25 + KEYWORD_SATURATION)`. */
export const KEYWORD_SATURATION = 4;

/** Words that say nothing about which provider a question wants. */
const STOP_WORDS = new Set(
  "a an the and or of to for in on at by with from is are be i me my we our you your it its this that what where who how can do does need want get find help near nearby around here there any some have has not no please now just".split(
    " ",
  ),
);

function stem(word: string): string {
  if (word.length > 4 && word.endsWith("sses")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** A need that questions and listings put in different words, found by phrase: one more token, named so that no word can be it. */
interface Concept {
  token: string;
  phrases: RegExp;
}

const LANGUAGE_NAMES =
  "english french spanish arabic urdu farsi persian dari pashto pushto punjabi hindi bengali bangla gujarati tamil tagalog filipino chinese mandarin cantonese greek slovak ukrainian russian polish portuguese italian somali tigrinya amharic turkish korean japanese vietnamese".split(
    " ",
  );
const LANGUAGE = `(?:${LANGUAGE_NAMES.join("|")})`;
const OTHER_LANGUAGE = `(?:${LANGUAGE_NAMES.filter((name) => name !== "english").join("|")})`;

const CONCEPTS: readonly Concept[] = [
  {
    // Learning English, in the residents' words and in the listings' (LINC and ESL classes, "language training"; not "Japanese
    // language classes").
    token: "concept:english-class",
    phrases: new RegExp(
      [
        "\\b(?:esl|linc)\\b",
        "\\b(?:learn(?:ing)?|stud(?:y|ying)|practi[cs](?:e|ing)|improv(?:e|ing)|speak(?:ing)?|teach(?:ing)?)\\s+(?:(?:my|some|the|better|more)\\s+)?english\\b",
        "\\benglish\\s+(?:language\\s+)?(?:class(?:es)?|lessons?|courses?|school|teachers?|tutors?|tutoring|conversation)\\b",
        `(?<!\\b${OTHER_LANGUAGE}\\s)\\blanguage\\s+(?:class(?:es)?|lessons?|courses?|training|school)\\b`,
      ].join("|"),
      "g",
    ),
  },
  {
    // Being made to leave a home (UAT 2026-11-04: "my landlord wants me to move out", the ask screen's own example, and "房东要我搬走"
    // through its English translation, found nothing): the residents' landlord and "kick me out" against the listings' eviction
    // prevention, illegal lockouts and tenant rights, and the Landlord and Tenant Board's notice forms (N4, N5, N12, N13).
    token: "concept:eviction",
    phrases: new RegExp(
      [
        "\\bevict(?:ion|ions|ed|ing|s)?\\b",
        "\\brenovict(?:ion|ions|ed|ing)?\\b",
        "\\blandlords?\\b",
        "\\b(?:kick(?:ed|ing|s)?|throw(?:n|ing|s)?|threw|put(?:ting)?|force(?:d|s)?|forcing|push(?:ed|ing)?)\\s+(?:me|us|him|her|them|my\\s+\\w+)\\s+out\\b",
        "\\b(?:make|makes|making|made|want(?:s|ed)?|tell(?:s|ing)?|told|ask(?:s|ed|ing)?)\\s+(?:me|us|him|her|them)\\s+(?:to\\s+)?(?:move|get|leave)\\s+out\\b",
        "\\b(?:lock(?:ed)?\\s+(?:me|us)\\s+out|illegal\\s+lockouts?)\\b",
        "\\btenant(?:'s|s'|s)?\\s+rights\\b",
        "\\bn(?:4|5|12|13)\\b",
      ].join("|"),
      "g",
    ),
  },
  {
    // Mental health and a mental health crisis (UAT 2026-11-04: "my son has a mental breakdown" found nothing): the residents'
    // breakdown, depression, anxiety or someone to talk to against the listings' mental health and counselling services. Not
    // occupational therapy. The 911 block for a crisis is the crisis phrases' (crisisPhrases.ts), not this.
    token: "concept:mental-health",
    phrases: new RegExp(
      [
        "\\bmental(?:ly)?\\s+(?:health|illness|breakdown|crisis|wellness|unwell)\\b",
        "\\b(?:nervous|emotional)\\s+breakdown\\b",
        "\\bbreak(?:ing)?\\s*down\\b",
        "\\bbreakdown\\b",
        "\\bdepress(?:ed|ion|ing)\\b",
        "\\banxi(?:ety|ous)\\b",
        "\\bpanic\\s+attacks?\\b",
        "\\bcounsell?(?:ing|or|ors)\\b",
        "\\bsomeone\\s+to\\s+talk\\s+to\\b",
        "\\bpsych(?:iatr\\w*|olog\\w*|otherap\\w*|osis|otic)\\b",
        "(?<!\\boccupational\\s)\\btherap(?:y|ist|ists)\\b",
      ].join("|"),
      "g",
    ),
  },
  {
    // Services for older people (UAT 2026-11-09: "老年人的服务", translated to "services for the elderly", showed an EarlyON centre
    // and youth services and none of the seniors' programs): the residents' elderly, older people, grandparents or a nursing home
    // against the listings' "seniors", "seniors 65+" and long-term care. Not a senior kindergarten or a senior high school.
    token: "concept:seniors",
    phrases: new RegExp(
      [
        "\\bseniors\\b(?!\\s+(?:kindergarten|high|public|school|staff))",
        "\\bsenior(?:'s|s')?\\s+(?:citizens?|centres?|centers?|club|programs?|services?|homes?|housing|care|day)\\b",
        "\\belders\\b",
        "\\belderly\\b",
        "\\b(?:older|aging|ageing|aged|old)\\s+(?:adults?|people|persons?|residents?|parents?|folks?|relatives?|mother|father|mom|dad|man|woman|men|women)\\b",
        "\\bold\\s+age\\b",
        "\\bgrand(?:mother|father|parent|ma|pa)s?\\b",
        "\\b(?:55|60|65)\\s*(?:\\+|plus\\b|and\\s+(?:over|older)\\b)",
        "\\blong[-\\s]term\\s+care\\b",
        "\\b(?:nursing|retirement)\\s+(?:homes?|residences?)\\b",
      ].join("|"),
      "g",
    ),
  },
];

// A clause that says the thing is not there: "no French immersion, ESL, or special education programs were listed".
const NEGATED = /\b(?:no|not|without)\b[^.;:]*$/;

/** The concepts of a text, once per phrase found, except a phrase in a clause that says it is not offered. */
function conceptTokens(lower: string): string[] {
  const tokens: string[] = [];
  for (const { token, phrases } of CONCEPTS) {
    for (const match of lower.matchAll(phrases)) {
      if (!NEGATED.test(lower.slice(0, match.index))) tokens.push(token);
    }
  }
  return tokens;
}

// Two or more language names in a row, joined by commas, "and" or "or": the languages a service is offered in.
const LANGUAGE_LIST = new RegExp(`\\b${LANGUAGE}(?:\\s*(?:,|\\band\\b|\\bor\\b|,\\s*and\\b|,\\s*or\\b)\\s*${LANGUAGE}\\b)+`, "g");

/**
 * The words of a text that the keyword match reads: lower case a to z runs, stop words and one-letter words out, plurals stemmed,
 * language names in a list of the languages a service is offered in left out (so "staff speak English and Urdu" is no English
 * class either); then the text's concepts (CONCEPTS).
 */
export function keywordTokens(text: string): string[] {
  const lower = text.toLowerCase().replace(LANGUAGE_LIST, " ");
  const words = lower.match(/[a-z]+/g) ?? [];
  return [...words.filter((w) => w.length > 1 && !STOP_WORDS.has(w)).map(stem), ...conceptTokens(lower)];
}

const isConcept = (token: string) => token.startsWith("concept:");

/** A provider's English text for the keyword match. */
export interface KeywordDocument {
  id: string;
  text: string;
}

export interface KeywordIndex {
  /** Number of documents. */
  readonly n: number;
  readonly averageLength: number;
  /** How many documents hold each word. */
  readonly documentFrequency: ReadonlyMap<string, number>;
  /** Each document's word counts and length. */
  readonly documents: ReadonlyMap<string, { counts: ReadonlyMap<string, number>; length: number }>;
}

export function buildKeywordIndex(docs: readonly KeywordDocument[]): KeywordIndex {
  const documents = new Map<string, { counts: Map<string, number>; length: number }>();
  const documentFrequency = new Map<string, number>();
  let total = 0;
  for (const doc of docs) {
    const tokens = keywordTokens(doc.text);
    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
    for (const token of counts.keys()) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    documents.set(doc.id, { counts, length: tokens.length });
    total += tokens.length;
  }
  const n = documents.size;
  return { n, averageLength: n === 0 ? 0 : total / n, documentFrequency, documents };
}

/** The part of a release's English listing that the keyword match reads (DirectoryListingV1, structurally). */
export interface ListingForKeywords {
  categories: readonly { id: string; name: { body: string } }[];
  providers: readonly { id: string; name: string; category_ids: readonly string[]; subcategories: readonly { body: string }[]; services: { body: string } }[];
}

/**
 * The English text of each provider of a release's English listing that the keyword match reads: its name, the names of its
 * categories, its subcategories and its services, the same fields the embedded search text is made of (searchData.ts) less the
 * emergency role.
 */
export function keywordDocumentsOf(listing: ListingForKeywords): KeywordDocument[] {
  const categoryNames = new Map(listing.categories.map((c) => [c.id, c.name.body]));
  return listing.providers.map((p) => ({
    id: p.id,
    text: [p.name, ...p.category_ids.map((id) => categoryNames.get(id) ?? ""), ...p.subcategories.map((s) => s.body), p.services.body].join(" "),
  }));
}

/** BM25 of the question's words (not its concepts) against each provider that matches at least one of them (the others score 0 and are left out). */
export function bm25Scores(index: KeywordIndex, text: string): Map<string, number> {
  const scores = new Map<string, number>();
  const words = [...new Set(keywordTokens(text))].filter((w) => !isConcept(w) && index.documentFrequency.has(w));
  if (words.length === 0 || index.averageLength === 0) return scores;
  for (const [id, doc] of index.documents) {
    let score = 0;
    for (const word of words) {
      const tf = doc.counts.get(word);
      if (tf === undefined) continue;
      const df = index.documentFrequency.get(word)!;
      const idf = Math.log(1 + (index.n - df + 0.5) / (df + 0.5));
      score += (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.length) / index.averageLength));
    }
    if (score > 0) scores.set(id, score);
  }
  return scores;
}

/**
 * What the keyword match adds to each provider's similarity for an English text: `weight × bm25 / (bm25 + KEYWORD_SATURATION)`,
 * from 0 up to (never reaching) `weight`, and `weight` once more when the provider holds a concept the text names (CONCEPTS), so
 * at most twice `weight`. Providers with no matching word or concept are left out (they add 0).
 */
export function keywordBoosts(index: KeywordIndex, text: string, weight: number): Map<string, number> {
  const boosts = new Map<string, number>();
  if (weight <= 0) return boosts;
  for (const [id, score] of bm25Scores(index, text)) boosts.set(id, (weight * score) / (score + KEYWORD_SATURATION));
  const concepts = [...new Set(keywordTokens(text))].filter(isConcept);
  if (concepts.length === 0) return boosts;
  for (const [id, doc] of index.documents) {
    if (concepts.some((concept) => doc.counts.has(concept))) boosts.set(id, (boosts.get(id) ?? 0) + weight);
  }
  return boosts;
}
