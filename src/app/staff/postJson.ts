/**
 * Browser side of the staff API: POSTs JSON to a same-origin `/api/staff` call and reads the
 * answer. `next` is where to go on success; otherwise `message` is the catalog text to show.
 */
export async function postStaffJson(path: string, body: unknown): Promise<{ ok: true; next: string } | { ok: false; message: string | null }> {
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
    return { ok: false, message: null };
  }
  const answer = (await response.json().catch(() => ({}))) as { next?: unknown; message?: unknown };
  if (response.ok && typeof answer.next === "string" && answer.next.startsWith("/staff")) return { ok: true, next: answer.next };
  return { ok: false, message: typeof answer.message === "string" ? answer.message : null };
}
