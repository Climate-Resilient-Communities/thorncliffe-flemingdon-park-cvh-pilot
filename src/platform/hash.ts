// SHA-256 hex of a UTF-8 string: the value scripts/content_catalogue.py computes (source_hash) for the
// offline-translated texts. Server-side only (node:crypto).
import { createHash } from "node:crypto";

export function sha256HexBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
