// TOTP (RFC 6238 over RFC 4226's HOTP, HMAC-SHA-1, 30-second steps) for the in-memory identity fake
// and the tests that type its codes. Supabase Auth checks real codes; nothing in the app's own
// path computes one. Test-only by use: the fake is refused outside local runs (env.ts).
import { createHash, createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, without padding (how authenticator apps show a secret). */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** RFC 4648 base32 (case, spaces and padding ignored). Throws on a letter outside the alphabet. */
export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Not a base32 secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const TOTP_STEP_SECONDS = 30;

/** The HOTP value of `counter` (RFC 4226 §5.3, dynamic truncation), `digits` long. */
export function hotp(key: Uint8Array, counter: number, digits = 6): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(message).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** The TOTP code of a key at a time (ms since the epoch). */
export function totpAt(key: Uint8Array, atMs: number, digits = 6): string {
  return hotp(key, Math.floor(atMs / 1000 / TOTP_STEP_SECONDS), digits);
}

/** The code an authenticator app shows for a base32 secret at `atMs` (default: now). */
export function totpCode(secret: string, atMs: number = Date.now()): string {
  return totpAt(base32Decode(secret), atMs);
}

/** True when `code` is the secret's code at `atMs`, one step either side allowed for clock drift (as Supabase does). */
export function totpMatches(secret: string, code: string, atMs: number = Date.now()): boolean {
  return [-1, 0, 1].some((step) => totpCode(secret, atMs + step * TOTP_STEP_SECONDS * 1000) === code);
}

/** The fake's secret for an auth user: deterministic, so a test can compute the user's codes without reading the fake. */
export function memoryTotpSecret(authUserId: string): string {
  return base32Encode(createHash("sha256").update(`cvh-memory-totp:${authUserId}`).digest().subarray(0, 20));
}
