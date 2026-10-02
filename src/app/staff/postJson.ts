import { SIGN_IN_PAGE } from "@/contracts/staffAuth";

/**
 * Browser side of the staff API: POSTs JSON to a same-origin `/api/staff` call and reads the
 * answer. `next` is where to go on success; otherwise `message` is the catalog text to show.
 * A 401 `unauthenticated` (the session ended: idle, 12 hours, or revoked, S01.08) sends the person
 * to sign-in.
 */
export async function postStaffJson(path: string, body: unknown): Promise<{ ok: true; next: string } | { ok: false; message: string | null }> {
  const result = await postStaffJsonAnswer(path, body);
  if (!result) return { ok: false, message: null };
  const { status, answer } = result;
  if (status === 401 && answer.error === "unauthenticated") return { ok: true, next: SIGN_IN_PAGE };
  if (status >= 200 && status < 300 && typeof answer.next === "string" && answer.next.startsWith("/staff")) return { ok: true, next: answer.next };
  return { ok: false, message: typeof answer.message === "string" ? answer.message : null };
}

/** POSTs JSON to a same-origin `/api/staff` call and returns the status and the JSON answer; null when the network failed. */
export async function postStaffJsonAnswer(path: string, body: unknown): Promise<{ status: number; answer: Record<string, unknown> } | null> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
  const answer = (await response.json().catch(() => ({}))) as unknown;
  return { status: response.status, answer: typeof answer === "object" && answer !== null ? (answer as Record<string, unknown>) : {} };
}
