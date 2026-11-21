// "Closest matches" (resident testing, session 2, #3): when search finds no clear match, a language model reads the question and a
// short line about every provider of the release and picks at most three that help, or none. Pure: the prompt it is sent and how
// its answer is read. The use case (application/search.ts) calls it only for a question search answered with no clear match and
// without the 911 block; it never decides `emergency_first`, and a question that describes an emergency is never sent (search.ts).
//
// Measured on 2026-11-21 on release 13's 40 "no clear match" answers of the search test set's tuning subset: 15 real questions
// answered right, 3 wrong, 2 still none; 16 of the 20 questions with no answer in the directory kept none, 4 got a near miss
// (a library for a bookstore). The page shows these results under "Closest matches", never as search results.

/** At most this many closest matches. */
export const CLOSEST_MAX = 3;

/** The part of a release's English listing the provider lines are made from (DirectoryListingV1, structurally). */
export interface ListingForClosest {
  categories: readonly { id: string; name: { body: string } }[];
  providers: readonly {
    id: string;
    name: string;
    category_ids: readonly string[];
    subcategories: readonly { body: string }[];
    helps_with?: readonly string[] | null;
  }[];
}

/**
 * One line per provider: `id | name | categories | subcategories and what it helps with`. Short on purpose: the whole list goes
 * with each question, so it is what the model can choose from and nothing else (no addresses, phone numbers or opening hours).
 */
export function closestCatalogueOf(listing: ListingForClosest): string {
  const names = new Map(listing.categories.map((c) => [c.id, c.name.body]));
  return listing.providers
    .map((p) => {
      const categories = p.category_ids.map((id) => names.get(id)).filter((name): name is string => Boolean(name));
      const about = [...p.subcategories.map((s) => s.body).slice(0, 3), ...(p.helps_with ?? []).slice(0, 6)];
      return `${p.id} | ${oneLine(p.name)} | ${categories.join(", ")} | ${about.map(oneLine).join("; ")}`;
    })
    .join("\n");
}

const oneLine = (text: string) => text.replace(/[\r\n|]+/g, " ").replace(/\s+/g, " ").trim();

/** The message sent to the model: the question (in any language) and the list. It asks for JSON and allows an empty answer. */
export function closestPrompt(question: string, catalogue: string): string {
  return `You help residents of Thorncliffe Park and Flemingdon Park (Toronto) find local services. A resident asked, in any language:

"${oneLine(question).replaceAll('"', "'")}"

Here is the full list of local services (id | name | category | what it helps with):
${catalogue}

Pick at most ${CLOSEST_MAX} services from the list that directly help with what the resident asked. If none of them clearly helps, pick none. Never guess: an empty answer is better than a wrong one.
Answer with JSON only, like {"ids": ["M001", "M002"]} or {"ids": []}.`;
}

/**
 * The ids in the model's answer that are providers of the release, in its order, without repeats, at most CLOSEST_MAX. Anything
 * else (an id the release does not have, prose, a broken answer) is dropped: the answer can only ever name the release's providers.
 */
export function closestIdsOf(answer: string, known: ReadonlySet<string>): string[] {
  let named: unknown[] = [];
  const json = answer.match(/\{[\s\S]*\}/);
  if (json) {
    try {
      const parsed = JSON.parse(json[0]) as { ids?: unknown };
      if (Array.isArray(parsed.ids)) named = parsed.ids;
    } catch {
      named = [];
    }
  }
  if (named.length === 0 && !json) named = answer.match(/\b[A-Z]\d{3,6}\b/g) ?? [];
  const ids: string[] = [];
  for (const id of named) {
    if (typeof id === "string" && known.has(id) && !ids.includes(id)) ids.push(id);
    if (ids.length === CLOSEST_MAX) break;
  }
  return ids;
}
