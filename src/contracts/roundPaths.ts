// The addresses of "My round" (S08.07, A-04): the page, where it reads the round and where it sends a mark. On their own, without zod, because the service
// worker's rules (src/app/offline/rules.ts) name them too and the worker's bundle stays small. Pure and browser-safe.

/** The round page (A-04). */
export const ROUND_PAGE = "/staff/ambassador/round";
/** Where the page reads the round (POST, answered no-store). */
export const ROUND_ROUTE = "/api/staff/ambassador/round";
/** Where the page sends a mark (POST). */
export const MARK_ROUTE = "/api/staff/ambassador/marks";
