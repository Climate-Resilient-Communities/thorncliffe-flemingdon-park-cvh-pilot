// The wire contract of POST /api/search (S03.04, AD-11, AD-20): the request a phone sends and the failure body the
// route answers with. The success body is SearchV1, defined with the test-set format (searchTestSet.ts) because the
// test-set runner checks the engine's answers against it. Pure and browser-safe.
import { z } from "zod";
import { LangCodeSchema, type LangCode } from "./lang";
import { MAX_QUESTION_LENGTH } from "./searchTestSet";

export { SearchV1Schema, type SearchV1 } from "./searchTestSet";

/** What a search can fail with: the HTTP status each code is answered with is in SEARCH_ERROR_STATUS. */
export const SEARCH_ERROR_CODES = ["invalid_request", "invalid_question", "invalid_lang", "rate_limited", "search_unavailable"] as const;
export type SearchErrorCode = (typeof SEARCH_ERROR_CODES)[number];

export const SEARCH_ERROR_STATUS: Record<SearchErrorCode, 400 | 429 | 503> = {
  invalid_request: 400,
  invalid_question: 400,
  invalid_lang: 400,
  rate_limited: 429,
  search_unavailable: 503,
};

/** The body of a failed search: `{error: {code, message_key}}` (AD-20). Never holds the question. */
export const SearchErrorSchema = z.strictObject({
  error: z.strictObject({ code: z.enum(SEARCH_ERROR_CODES), message_key: z.string().regex(/^search\.[a-z_]+$/) }),
});
export type SearchError = z.infer<typeof SearchErrorSchema>;

export const searchErrorBody = (code: SearchErrorCode): SearchError => ({ error: { code, message_key: `search.${code}` } });

/** What the phone sends: the question, the language of the page it asks from, and the release number it holds. */
export interface SearchRequest {
  q: string;
  lang: LangCode;
  /** The release the client holds, when it knows one; a newer current release is answered with its own `release_v`. */
  v?: number;
}

export type SearchRequestResult = { ok: true; value: SearchRequest } | { ok: false; code: "invalid_request" | "invalid_question" | "invalid_lang" };

/**
 * Checks a request body. The question is trimmed, then must be 1 to 200 characters; `lang` must be a LangCode. Pure: it
 * keeps nothing of the question and the code it returns names the rule, not the text.
 */
export function parseSearchRequest(raw: unknown): SearchRequestResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, code: "invalid_request" };
  const body = raw as { q?: unknown; lang?: unknown; v?: unknown };
  if (typeof body.q !== "string") return { ok: false, code: "invalid_question" };
  const q = body.q.trim();
  if (q === "" || [...q].length > MAX_QUESTION_LENGTH) return { ok: false, code: "invalid_question" };
  const lang = LangCodeSchema.safeParse(body.lang);
  if (!lang.success) return { ok: false, code: "invalid_lang" };
  if (body.v !== undefined && !(typeof body.v === "number" && Number.isInteger(body.v) && body.v >= 0)) return { ok: false, code: "invalid_request" };
  return { ok: true, value: { q, lang: lang.data, ...(body.v === undefined ? {} : { v: body.v as number }) } };
}
