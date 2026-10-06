// The pg_cron statements docs/config.md gives the owner to run once in production's Supabase SQL editor (S09.08's review: one of them did not parse). Each
// block is run as written against a real Supabase server, as `postgres`, in a transaction that is rolled back: it must be valid SQL that pg_cron accepts (its
// schedule parsed and the job stored with its command), so that no documented job is left unscheduled in production until someone notices. The jobs'
// commands are not run (they read the Vault's secrets and call the app).
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { connect, ROOT, serverUrl } from "./helpers";

const config = readFileSync(path.join(ROOT, "docs", "config.md"), "utf8");

/** Every ```sql block of docs/config.md that schedules a pg_cron job, with the names of the jobs it schedules. */
const blocks = [...config.matchAll(/```sql\n([\s\S]*?)```/g)]
  .map((match) => match[1]!)
  .filter((block) => block.includes("cron.schedule("))
  .map((block) => ({ block, jobs: [...block.matchAll(/cron\.schedule\('([^']+)'/g)].map((match) => match[1]!) }));

let owner: ReturnType<typeof connect>;

/** Rolls the scheduling back: the test schedules nothing. */
class RolledBack extends Error {}

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
});

afterAll(async () => {
  await owner.end({ timeout: 5 });
});

/** Runs a block in a transaction that is rolled back, and returns the jobs it stored. */
async function scheduled(block: string): Promise<{ jobname: string; schedule: string; command: string }[]> {
  let jobs: { jobname: string; schedule: string; command: string }[] = [];
  await owner
    .begin(async (tx) => {
      await tx.unsafe(block).simple();
      jobs = (await tx`select jobname, schedule, command from cron.job order by jobname`) as unknown as typeof jobs;
      throw new RolledBack();
    })
    .catch((error: unknown) => {
      if (!(error instanceof RolledBack)) throw error;
    });
  return jobs;
}

describe("the pg_cron statements of docs/config.md", () => {
  it("are found, the end-of-pilot jobs among them", () => {
    const names = blocks.flatMap((one) => one.jobs);
    expect(names).toEqual(expect.arrayContaining(["cvh-dispatch", "cvh-health", "cvh-expire", "cvh-campaign-end", "cvh-end-of-pilot-purge"]));
  });

  it.each(blocks.map((one) => [one.jobs.join(", "), one.block] as const))("%s: runs as written and schedules its job with its command", async (_jobs, block) => {
    const jobs = await scheduled(block);
    const names = [...block.matchAll(/cron\.schedule\('([^']+)'/g)].map((match) => match[1]!);
    for (const name of names) {
      const job = jobs.find((one) => one.jobname === name);
      expect(job, name).toBeDefined();
      // The command is the statement between the dollar quotes, whole: a call of the app's job route (or the database's own work).
      expect(job!.command.trim().length).toBeGreaterThan(0);
      expect(job!.command).not.toContain("$$");
    }
  });

  it("runs the end-of-pilot purge 5 minutes after the end job, so the end's counts are taken before the purge begins", async () => {
    const all = [];
    for (const one of blocks) all.push(...(await scheduled(one.block)));
    expect(all.find((job) => job.jobname === "cvh-campaign-end")?.schedule).toBe("*/15 * * * *");
    expect(all.find((job) => job.jobname === "cvh-end-of-pilot-purge")?.schedule).toBe("5,20,35,50 * * * *");
    expect(all.find((job) => job.jobname === "cvh-end-of-pilot-purge")?.command).toContain("/api/jobs/end-of-pilot-purge");
  });
});
