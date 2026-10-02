import { randomBytes } from "node:crypto";

/**
 * A UUIDv7 (RFC 9562), the id of every row that is not keyed by a natural key (spine: IDs):
 * 48 bits of Unix milliseconds, then the version, 74 random bits and the variant. Ids made
 * later sort after earlier ones (to the millisecond), which keeps primary-key indexes compact.
 */
export function uuidv7(now: number = Date.now(), random: Uint8Array = randomBytes(10)): string {
  const bytes = new Uint8Array(16);
  let ms = BigInt(Math.floor(now));
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number(ms & BigInt(0xff));
    ms >>= BigInt(8);
  }
  bytes.set(random.subarray(0, 10), 6);
  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
