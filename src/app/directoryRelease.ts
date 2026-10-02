// Composition root of the directory release for the app (AD-2): the database connection and the private
// store the release files are kept in. Server only. The staff screen publishes with it
// (src/app/staff/directory.ts); the resident routes under src/app/api/directory read with it.
//
// Locally (never on Vercel: the environment check refuses it there), CVH_FAKE_DIRECTORY_DIR keeps the
// files in a folder instead of the Supabase Storage bucket, for the end-to-end tests.
import { fileDirectoryStorage, supabaseDirectoryStorage, type DirectoryStorage } from "@/modules/directory";
import { getEnv } from "@/platform/config/env";

let storage: DirectoryStorage | undefined;

/** The private store of the release files. Throws when this environment has none configured. */
export function directoryStorage(): DirectoryStorage {
  if (storage) return storage;
  const env = getEnv();
  if (env.fakeDirectoryDir) {
    storage = fileDirectoryStorage(env.fakeDirectoryDir);
  } else if (env.supabaseUrl && env.supabaseSecretKey) {
    storage = supabaseDirectoryStorage({ url: env.supabaseUrl, secretKey: env.supabaseSecretKey });
  } else {
    throw new Error("The directory store is not configured: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  }
  return storage;
}
