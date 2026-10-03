import { describe, expect, it } from "vitest";
import { readUnconfirmed, reconcile, sessionKeyStorage, writeUnconfirmed, type KeyStorage } from "./submitStore";

const ENTRY = "01900000-0000-7000-8000-00000000e177";
const OTHER_ENTRY = "01900000-0000-7000-8000-00000000e178";
const KEY = "0f0e0d0c-0b0a-4908-8706-050403020100";

function memory(): KeyStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return { items, getItem: (name) => items.get(name) ?? null, setItem: (name, value) => void items.set(name, value), removeItem: (name) => void items.delete(name) };
}
const broken: KeyStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("full");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("the key kept for an entry", () => {
  it("is written and read back for that entry only, and forgotten with null", () => {
    const storage = memory();

    writeUnconfirmed(ENTRY, { key: KEY, kind: "submit" }, storage);

    expect(readUnconfirmed(ENTRY, storage)).toEqual({ key: KEY, kind: "submit" });
    expect(readUnconfirmed(OTHER_ENTRY, storage)).toBeNull();
    writeUnconfirmed(ENTRY, null, storage);
    expect(readUnconfirmed(ENTRY, storage)).toBeNull();
    expect(storage.items.size).toBe(0);
  });

  it("is never what is not a key and a kind: a hand-edited or old value is ignored", () => {
    const storage = memory();
    for (const bad of ["", "not json", "null", "7", JSON.stringify({ key: "short", kind: "submit" }), JSON.stringify({ key: KEY, kind: "other" }), JSON.stringify({ key: 5, kind: "submit" }), JSON.stringify({ kind: "submit" })]) {
      storage.setItem(`cvh.submit-key.${ENTRY}`, bad);
      expect(readUnconfirmed(ENTRY, storage), bad).toBeNull();
    }
  });

  it("works the same without storage, or with storage that throws: nothing is kept and nothing fails", () => {
    expect(readUnconfirmed(ENTRY, null)).toBeNull();
    expect(() => writeUnconfirmed(ENTRY, { key: KEY, kind: "submit" }, null)).not.toThrow();
    expect(readUnconfirmed(ENTRY, broken)).toBeNull();
    expect(() => writeUnconfirmed(ENTRY, { key: KEY, kind: "submit" }, broken)).not.toThrow();
    expect(() => writeUnconfirmed(ENTRY, null, broken)).not.toThrow();
  });

  it("has no session storage outside a browser", () => {
    expect(sessionKeyStorage()).toBeNull();
  });
});

describe("a key kept, when the page loads", () => {
  it("is confirmed when the entry's latest attempt is that key: its outcome is on the screen", () => {
    expect(reconcile({ key: KEY, kind: "submit" }, KEY)).toBeNull();
  });

  it("is still unconfirmed when the server shows no attempt, or another one: it goes on being sent", () => {
    expect(reconcile({ key: KEY, kind: "submit" }, null)).toEqual({ key: KEY, kind: "submit" });
    expect(reconcile({ key: KEY, kind: "submit" }, "ffffffff-0b0a-4908-8706-050403020100")).toEqual({ key: KEY, kind: "submit" });
    expect(reconcile(null, KEY)).toBeNull();
  });
});
