// The compact form of a release's vectors file (performance of the search's cold start). The same numbers as
// `vectors.json`, as little-endian Float32 behind a small JSON header, so a cold instance downloads about a third of
// the bytes and reads the numbers without parsing 184k of them from text.
//
// Layout of `releases/{n}/vectors.bin`:
//   bytes 0-3    the magic "CVHV"
//   bytes 4-7    the length of the header, an unsigned 32-bit little-endian number
//   next         the header, UTF-8 JSON (VectorsBinaryHeader), then zeros up to a multiple of 4 bytes from the file's start
//   then         count x dims Float32, little-endian, one vector after the other in the order of `ids`
//
// The header names the release, the catalogue version, the model, the dimensions, the provider ids in order (the order of
// the vectors) and the sha256 of the number block. The release's record names the sha256 of the whole file, which is what a
// reader checks first, exactly as it does for the JSON file. Numbers are stored as Float32 (the precision the embedding
// model answers in); the JSON file stays the exact copy, and earlier-release reuse reads that one.
import { z } from "zod";

const MAGIC = [0x43, 0x56, 0x48, 0x56]; // "CVHV"
const PREFIX = 8;

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const VectorsBinaryHeaderSchema = z.strictObject({
  v: z.literal(1),
  release_v: z.number().int().positive(),
  catalogue_hash: Sha256,
  embed_model: z.string().min(1),
  dims: z.number().int().min(0),
  count: z.number().int().min(0),
  ids: z.array(z.string().min(1)),
  data_sha256: Sha256,
});
export type VectorsBinaryHeader = z.infer<typeof VectorsBinaryHeaderSchema>;

export class VectorsBinaryError extends Error {}

const pad4 = (n: number) => (4 - (n % 4)) % 4;

/** The file for these entries (in the order the vectors are to be stored), or throws when they are not one block of equal, finite vectors. */
export function encodeVectorsBinary(
  input: {
    releaseV: number;
    catalogueHash: string;
    embedModel: string;
    entries: readonly { id: string; vector: readonly number[] }[];
  },
  sha256: (bytes: Uint8Array) => string,
): Uint8Array {
  const dims = input.entries[0]?.vector.length ?? 0;
  const numbers = new Uint8Array(input.entries.length * dims * 4);
  const view = new DataView(numbers.buffer);
  input.entries.forEach((entry, row) => {
    if (entry.vector.length !== dims) throw new VectorsBinaryError("vectors of different sizes");
    entry.vector.forEach((n, col) => {
      if (!Number.isFinite(n)) throw new VectorsBinaryError("not a number");
      view.setFloat32((row * dims + col) * 4, n, true);
    });
  });
  const header: VectorsBinaryHeader = {
    v: 1,
    release_v: input.releaseV,
    catalogue_hash: input.catalogueHash,
    embed_model: input.embedModel,
    dims,
    count: input.entries.length,
    ids: input.entries.map((e) => e.id),
    data_sha256: sha256(numbers),
  };
  const head = new TextEncoder().encode(JSON.stringify(VectorsBinaryHeaderSchema.parse(header)));
  const start = PREFIX + head.length + pad4(PREFIX + head.length);
  const out = new Uint8Array(start + numbers.length);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, head.length, true);
  out.set(head, PREFIX);
  out.set(numbers, start);
  return out;
}

export interface DecodedVectors {
  header: VectorsBinaryHeader;
  /** One Float32Array per provider, in the order of `header.ids`, all views on one block. */
  vectors: Float32Array[];
}

/** Reads the file, checking its structure and the number block's sha256 against the header. Throws a VectorsBinaryError when it is not a valid file. */
export function decodeVectorsBinary(bytes: Uint8Array, sha256: (bytes: Uint8Array) => string): DecodedVectors {
  if (bytes.length < PREFIX || MAGIC.some((b, i) => bytes[i] !== b)) throw new VectorsBinaryError("magic");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headLength = view.getUint32(4, true);
  if (PREFIX + headLength > bytes.length) throw new VectorsBinaryError("header_length");
  let header: VectorsBinaryHeader;
  try {
    header = VectorsBinaryHeaderSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(PREFIX, PREFIX + headLength))));
  } catch {
    throw new VectorsBinaryError("header");
  }
  if (header.ids.length !== header.count || new Set(header.ids).size !== header.count) throw new VectorsBinaryError("ids");
  const start = PREFIX + headLength + pad4(PREFIX + headLength);
  if (bytes.length !== start + header.count * header.dims * 4) throw new VectorsBinaryError("size");
  const block = bytes.subarray(start);
  if (sha256(block) !== header.data_sha256) throw new VectorsBinaryError("data_hash");

  // Copied out with an explicit byte order: a downloaded buffer need not start on a 4-byte boundary.
  const all = new Float32Array(header.count * header.dims);
  const source = new DataView(block.buffer, block.byteOffset, block.byteLength);
  for (let i = 0; i < all.length; i += 1) all[i] = source.getFloat32(i * 4, true);
  const vectors = header.ids.map((_, row) => all.subarray(row * header.dims, (row + 1) * header.dims));
  return { header, vectors };
}
