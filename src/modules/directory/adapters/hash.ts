// SHA-256 hex of the UTF-8 text: the hash scripts/content_catalogue.py computes (source_hash).
export { sha256Hex as sourceHash } from "@/platform/hash";

import { createHash } from "node:crypto";

/**
 * The id of an English text in the provider catalogue and its translation files: the first 12 hex
 * digits of the SHA-1 of the text (scripts/build_catalogue.py, text_id). A key, not a security hash.
 */
export function catalogueTextId(english: string): string {
  return createHash("sha1").update(english, "utf8").digest("hex").slice(0, 12);
}
