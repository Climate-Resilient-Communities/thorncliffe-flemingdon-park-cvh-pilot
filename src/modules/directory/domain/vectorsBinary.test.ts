import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { VectorsBinaryError, decodeVectorsBinary, encodeVectorsBinary } from "./vectorsBinary";

const sha256HexBytes = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const CATALOGUE = "c".repeat(64);
const entries = [
  { id: "M001", vector: [0.25, -0.5, 1, 0] },
  { id: "M002", vector: [0.1, 0.2, 0.3, 0.4] },
  { id: "P3", vector: [-1, 0, 0.125, 2] },
];
const encode = (list = entries) => encodeVectorsBinary({ releaseV: 7, catalogueHash: CATALOGUE, embedModel: "embed-v4.0", entries: list }, sha256HexBytes);

describe("the compact vectors file", () => {
  it("round-trips: the header, the provider order and every number (as Float32)", () => {
    const { header, vectors } = decodeVectorsBinary(encode(), sha256HexBytes);

    expect(header).toMatchObject({ v: 1, release_v: 7, catalogue_hash: CATALOGUE, embed_model: "embed-v4.0", dims: 4, count: 3, ids: ["M001", "M002", "P3"] });
    expect(vectors.map((v) => [...v])).toEqual(entries.map((e) => e.vector.map(Math.fround)));
  });

  it("starts with the magic and a little-endian header length, and keeps the numbers little-endian on a 4-byte boundary", () => {
    const bytes = encode();
    const view = new DataView(bytes.buffer);
    const headLength = view.getUint32(4, true);

    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("CVHV");
    expect(JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headLength))).data_sha256).toMatch(/^[0-9a-f]{64}$/);
    const start = bytes.length - 3 * 4 * 4;
    expect(start % 4).toBe(0);
    expect(view.getFloat32(start, true)).toBe(0.25);
    expect(bytes[start + 3]).toBe(0x3e); // 0.25 is 0x3e800000, least significant byte first
  });

  it("reads a buffer that does not start on a 4-byte boundary", () => {
    const bytes = encode();
    const shifted = new Uint8Array(bytes.length + 3).subarray(3);
    shifted.set(bytes);

    expect([...decodeVectorsBinary(shifted, sha256HexBytes).vectors[1]!]).toEqual(entries[1]!.vector.map(Math.fround));
  });

  it("holds an empty release", () => {
    const { header, vectors } = decodeVectorsBinary(encode([]), sha256HexBytes);

    expect(header).toMatchObject({ dims: 0, count: 0, ids: [] });
    expect(vectors).toEqual([]);
  });

  it("refuses vectors that are not one block of finite numbers", () => {
    expect(() => encode([entries[0]!, { id: "X", vector: [1] }])).toThrow(VectorsBinaryError);
    expect(() => encode([{ id: "X", vector: [Number.NaN, 1, 1, 1] }])).toThrow(VectorsBinaryError);
  });

  it("refuses a file whose numbers changed (the header's hash of them)", () => {
    const bytes = encode();
    bytes[bytes.length - 1] ^= 0x01;

    expect(() => decodeVectorsBinary(bytes, sha256HexBytes)).toThrow("data_hash");
  });

  it.each([
    ["a wrong magic", (b: Uint8Array) => void (b[0] = 0)],
    ["a header longer than the file", (b: Uint8Array) => new DataView(b.buffer).setUint32(4, 1e6, true)],
  ])("refuses %s", (_name, damage) => {
    const bytes = encode();
    damage(bytes);

    expect(() => decodeVectorsBinary(bytes, sha256HexBytes)).toThrow(VectorsBinaryError);
  });

  it("refuses a truncated file and one with trailing bytes", () => {
    const bytes = encode();

    expect(() => decodeVectorsBinary(bytes.subarray(0, bytes.length - 4), sha256HexBytes)).toThrow("size");
    expect(() => decodeVectorsBinary(new Uint8Array([...bytes, 0]), sha256HexBytes)).toThrow("size");
  });
});
