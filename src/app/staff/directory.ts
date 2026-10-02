// Composition root of the directory module for the staff surface (AD-2): the app's database
// connection (cvh_app_login) and what the publish job needs besides it. Server only. A seam of its
// own, like ./identity.ts, so the tests that call the staff pages and actions directly can hand them
// a database and a store.
import path from "node:path";
import { catalogueVersion, openccZhHant, readProviderNeighbourhoods, type PublishDeps } from "@/modules/directory";
import { recordOpsEvent } from "@/modules/ops";
import { getDb } from "@/platform/db";
import type { Db } from "@/platform/db";
import { directoryStorage } from "../directoryRelease";

/** The database the providers screen reads and its actions write. */
export function directoryDb(): Db {
  return getDb();
}

/**
 * What "Publish directory" runs with: the private store, the committed catalogue's version (the files deployed
 * with the app), OpenCC, and ops_event as the place a failed publish is recorded (directory may not import ops,
 * so the app wires the two).
 */
export function directoryPublishDeps(): PublishDeps {
  return {
    storage: directoryStorage(),
    catalogue: () => catalogueVersion(path.join(process.cwd(), "data", "catalogue"), process.env.APP_VERSION),
    neighbourhoods: async () => readProviderNeighbourhoods(path.join(process.cwd(), "data", "catalogue")),
    zhHant: openccZhHant,
    onFailure: async (failure) => {
      await recordOpsEvent(directoryDb(), {
        kind: "directory.publish_failed",
        ...(failure.release === null ? {} : { subjectType: "directory_release", subjectId: String(failure.release) }),
        detail: { reason: failure.reason, attempts: failure.attempts, files_stored: failure.filesStored },
      });
    },
  };
}
