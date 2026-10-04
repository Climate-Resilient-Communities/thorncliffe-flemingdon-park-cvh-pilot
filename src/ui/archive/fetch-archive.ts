import { ArchiveV1, archivePath } from "@/contracts/feed";

/**
 * One page of the archive from the server (S05.07), or null when it could not be read: no signal, a refusal, an answer that is not an archive, or no answer within
 * `timeoutMs`. `GET /api/feed/archive?lang=&page=` and nothing else, with no credentials, no body and no header of ours, so every resident makes the same request (AD-3).
 */
export async function fetchArchivePage(lang: string, page: number, fetcher: typeof fetch = fetch, timeoutMs = 20_000): Promise<ArchiveV1 | null> {
  const own = new AbortController();
  const timer = setTimeout(() => own.abort(), timeoutMs);
  try {
    const response = await fetcher(archivePath(lang, page), { credentials: "omit", headers: { Accept: "application/json" }, signal: own.signal });
    const text = await response.text();
    if (!response.ok) return null;
    const parsed = ArchiveV1.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
