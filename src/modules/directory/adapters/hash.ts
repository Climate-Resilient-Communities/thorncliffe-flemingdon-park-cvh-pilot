// SHA-256 hex of the UTF-8 text: the hash scripts/content_catalogue.py computes (source_hash).
import { createHash } from "node:crypto";

export function sourceHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
