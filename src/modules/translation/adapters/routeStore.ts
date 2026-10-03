// Reads `translation_route` (S04.02, AD-10): the routes alerts are translated by. Config, not code: it changes by migration,
// and is read for each translation so a changed route applies to the next submit. The app's role can only read it.
import { asc } from "drizzle-orm";
import type { DbExecutor } from "@/platform/db";
import { buildRoutes, type TranslationRoute } from "../domain/alertRoutes";
import { translationRoute } from "./schema";

/** The routes the table holds, one per language that has rows. Throws RouteConfigError for rows that are not a route (a bad migration). */
export async function readTranslationRoutes(executor: DbExecutor): Promise<TranslationRoute[]> {
  const rows = await executor
    .select()
    .from(translationRoute)
    .orderBy(asc(translationRoute.lang), asc(translationRoute.position));
  return buildRoutes(
    rows.map((row) => ({
      lang: row.lang,
      position: row.position,
      model: row.model,
      attemptTimeoutMs: row.attemptTimeoutMs,
      eldCode: row.eldCode,
      script: row.script,
      markerLetters: row.markerLetters,
      excludedLetters: row.excludedLetters,
      source: row.source,
    })),
  );
}
