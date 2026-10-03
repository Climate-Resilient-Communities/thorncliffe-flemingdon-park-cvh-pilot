// The translation cache in Postgres (S04.02, AD-10): passing results under every part of the key. The table itself refuses
// anything but a passing result (status `ok` or `script_converted`), so a failure cannot be cached whatever a caller does.
import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "@/platform/db";
import type { LangCode } from "@/contracts/lang";
import type { TranslationCache } from "../application/alertPorts";
import { translationCache } from "./schema";

export function drizzleTranslationCache(executor: DbExecutor): TranslationCache {
  return {
    async get(key) {
      const [row] = await executor
        .select({ body: translationCache.body, status: translationCache.status, fromTextHash: translationCache.fromTextHash })
        .from(translationCache)
        .where(
          and(
            eq(translationCache.sourceHash, key.sourceHash),
            eq(translationCache.lang, key.lang),
            eq(translationCache.modelId, key.modelId),
            eq(translationCache.promptVersion, key.promptVersion),
            eq(translationCache.checkVersion, key.checkVersion),
            eq(translationCache.openccVersion, key.openccVersion),
            eq(translationCache.openccConfig, key.openccConfig),
          ),
        );
      if (!row || (row.status !== "ok" && row.status !== "script_converted")) return null;
      return { body: row.body, status: row.status, fromTextHash: row.fromTextHash };
    },
    async put(key, value) {
      const values = {
        sourceHash: key.sourceHash,
        lang: key.lang as LangCode,
        modelId: key.modelId,
        promptVersion: key.promptVersion,
        checkVersion: key.checkVersion,
        openccVersion: key.openccVersion,
        openccConfig: key.openccConfig,
        body: value.body,
        status: value.status,
        fromTextHash: value.fromTextHash,
      };
      // A model's text is written once: whoever got there first stands, and the table's update policy gives the app no way to
      // change it. A conversion is replaced when it was made from another zh text.
      if (value.status === "ok") await executor.insert(translationCache).values(values).onConflictDoNothing();
      else
        await executor
          .insert(translationCache)
          .values(values)
          .onConflictDoUpdate({
            target: [
              translationCache.sourceHash,
              translationCache.lang,
              translationCache.modelId,
              translationCache.promptVersion,
              translationCache.checkVersion,
              translationCache.openccVersion,
              translationCache.openccConfig,
            ],
            set: { body: values.body, fromTextHash: values.fromTextHash },
          });
    },
  };
}
