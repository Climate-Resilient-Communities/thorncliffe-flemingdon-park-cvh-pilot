import { beforeEach, describe, expect, it, vi } from "vitest";

// The guard is tested on its own; here it only hands the action a session. What is under test is the cache expiry after a publish.
vi.mock("../guard", () => ({
  staffAction:
    (_spec: unknown, act: (session: { staffId: string }, ...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      act({ staffId: "staff-1" }, ...args),
}));
vi.mock("../directory", () => ({ directoryDb: () => ({}), directoryPublishDeps: () => ({}) }));
vi.mock("server-only", () => ({}));
const published = vi.hoisted(() => ({ state: { status: "done" } as { status: string } }));
vi.mock("./publishRelease", () => ({ publishFromForm: async () => published.state }));
const cache = vi.hoisted(() => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn(), unstable_cache: vi.fn() }));
vi.mock("next/cache", () => cache);

const { publishDirectoryAction } = await import("./actions");
const call = () => (publishDirectoryAction as unknown as (previous: unknown, form: FormData) => Promise<unknown>)({ status: "idle" }, new FormData());

beforeEach(() => {
  cache.revalidateTag.mockClear();
  cache.revalidatePath.mockClear();
});

describe("publishDirectoryAction", () => {
  it("expires the release files cache after a publish that is done", async () => {
    published.state = { status: "done" };
    await call();
    expect(cache.revalidateTag).toHaveBeenCalledWith("directory-release", { expire: 0 });
    expect(cache.revalidatePath).toHaveBeenCalled();
  });

  it("leaves the cache alone when the publish was refused", async () => {
    published.state = { status: "refused" };
    await call();
    expect(cache.revalidateTag).not.toHaveBeenCalled();
  });
});
