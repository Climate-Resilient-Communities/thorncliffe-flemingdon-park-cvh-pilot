// Where a seed writes (S02.04 providers, S02.09 guides). The target is always explicit:
// SEED_DATABASE_URL, with no fallback to MIGRATE_DATABASE_URL or anything else, so a shell that
// happens to have the migration URL exported cannot seed the wrong database. The transaction pooler
// (port 6543) is refused, the target host and database are printed before anything is written, and a
// host other than this machine needs --yes.
import { checkMigrationUrl } from "../db/migrate.mjs";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export type SeedTarget = { ok: true; url: string; host: string; database: string } | { ok: false; errors: string[] };

export function resolveSeedTarget(argv: string[], env: Readonly<Record<string, string | undefined>>): SeedTarget {
  const url = env.SEED_DATABASE_URL;
  if (!url) {
    return {
      ok: false,
      errors: ["SEED_DATABASE_URL is not set: name the database to seed explicitly (a session-mode connection, port 5432)"],
    };
  }
  try {
    checkMigrationUrl(url, "SEED_DATABASE_URL");
  } catch (error) {
    const e = error as Error & { title?: string; problems?: string[] };
    return { ok: false, errors: [e.title ?? e.message, ...(e.problems ?? [])] };
  }
  const parsed = new URL(url);
  const host = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "(default)";
  if (!LOCAL_HOSTS.has(parsed.hostname) && !argv.includes("--yes")) {
    return {
      ok: false,
      errors: [
        `SEED_DATABASE_URL points at ${host}, database ${database}, which is not this machine: nothing was written`,
        "run again with --yes to seed it",
      ],
    };
  }
  return { ok: true, url, host, database };
}

/** Resolves the target and prints it; returns the URL to seed, or null after printing why not. */
export function announceSeedTarget(argv: string[], env: Readonly<Record<string, string | undefined>>): string | null {
  const target = resolveSeedTarget(argv, env);
  if (!target.ok) {
    for (const line of target.errors) console.error(line);
    return null;
  }
  console.log(`Seeding host ${target.host}, database ${target.database}`);
  return target.url;
}
