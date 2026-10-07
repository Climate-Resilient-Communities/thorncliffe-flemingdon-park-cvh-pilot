// The keyword half of search's ranking (interim tuning, 2026-10-07; data/search-test-set/reports/2026-10-07-interim-tuning.md).
// Pure and deterministic: no dependency, no model, no vendor call.
//
// A question's words are matched against each provider's English name, category names, subcategory names and services text
// with BM25 (k1 = 1.2, b = 0.75). The index is built once per release, when its search data is loaded, from the English listing
// file the search already reads (no other file, nothing stored). The tokenizer is plain: lower case, runs of the letters a to z,
// a short list of English stop words dropped, a plural `s` (and `ies` to `y`) taken off. A text with no English words (any other
// script) has no tokens and gets no boost.
//
// The ranking adds `weight × bm25 / (bm25 + KEYWORD_SATURATION)` to a provider's similarity (searchRanking.ts), so the boost is
// at most `weight` however many words match. Only English text is matched: an English question, and the English translation of
// the translated-question leg.
import type { DirectoryListingV1 } from "@/contracts/directory";

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
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** The words of a text that the keyword match reads: lower case a to z runs, stop words and one-letter words out, plurals stemmed. */
export function keywordTokens(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  return words.filter((w) => w.length > 1 && !STOP_WORDS.has(w)).map(stem);
}

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

/**
 * The English text of each provider of a release's English listing that the keyword match reads: its name, the names of its
 * categories, its subcategories and its services, the same fields the embedded search text is made of (searchData.ts) less the
 * emergency role.
 */
export function keywordDocumentsOf(listing: DirectoryListingV1): KeywordDocument[] {
  const categoryNames = new Map(listing.categories.map((c) => [c.id, c.name.body]));
  return listing.providers.map((p) => ({
    id: p.id,
    text: [p.name, ...p.category_ids.map((id) => categoryNames.get(id) ?? ""), ...p.subcategories.map((s) => s.body), p.services.body].join(" "),
  }));
}

/** BM25 of the question's words against each provider that matches at least one of them (the others score 0 and are left out). */
export function bm25Scores(index: KeywordIndex, text: string): Map<string, number> {
  const scores = new Map<string, number>();
  const words = [...new Set(keywordTokens(text))].filter((w) => index.documentFrequency.has(w));
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
 * from 0 up to (never reaching) `weight`. Providers with no matching word are left out (they add 0).
 */
export function keywordBoosts(index: KeywordIndex, text: string, weight: number): Map<string, number> {
  const boosts = new Map<string, number>();
  if (weight <= 0) return boosts;
  for (const [id, score] of bm25Scores(index, text)) boosts.set(id, (weight * score) / (score + KEYWORD_SATURATION));
  return boosts;
}
