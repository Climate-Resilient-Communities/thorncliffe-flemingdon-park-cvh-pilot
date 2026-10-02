// The publish job runs in the server action of /staff/directory, whose function lives `maxDuration` seconds
// (src/app/staff/directory/page.tsx). Three numbers must stay in order, or a stopped function leaves a lease nobody can
// wait out, or a live one is taken over:
//
//     PUBLISH_BUDGET_MS  <  maxDuration  <  DEFAULT_LEASE_MS
//
// The job stops retrying after the budget and lets go of its lease; the lease outlasts the function, with a margin, so a
// second press cannot take the release over from a function that is still running.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LEASE_MS, PUBLISH_BUDGET_MS } from "@/modules/directory";

const page = readFileSync(path.join(__dirname, "..", "src", "app", "staff", "directory", "page.tsx"), "utf8");
const maxDurationMs = Number(/^export const maxDuration = (\d+);/m.exec(page)?.[1]) * 1000;

const MARGIN_MS = 30 * 1000;

describe("the publish job's clock", () => {
  it("reads the page's maxDuration", () => {
    expect(maxDurationMs).toBeGreaterThan(0);
  });

  it("keeps the lease longer than the function can run, with a margin", () => {
    expect(DEFAULT_LEASE_MS).toBeGreaterThan(maxDurationMs + MARGIN_MS);
  });

  it("stops retrying well before the function is stopped, leaving time to release the lease and answer", () => {
    expect(PUBLISH_BUDGET_MS).toBeLessThan(maxDurationMs - 10 * 1000);
  });
});
