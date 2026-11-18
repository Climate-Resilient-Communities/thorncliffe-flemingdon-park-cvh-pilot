"use client";

import { useTranslations } from "next-intl";
import type { RunBy } from "@/contracts/directory";
import { ResidentText } from "../text/resident-text";
import "./directory.css";

/**
 * Who runs a provider (resident testing, session 2, #4 and #11): an established service (a pillared building) or a community group
 * (two people), always as a mark and words together, so the difference never rests on colour alone. Nothing when the list does not say.
 */
export function RunByMark({ runBy, testId }: { runBy: RunBy | null; testId?: string }) {
  const t = useTranslations();
  if (runBy === null) return null;
  return (
    <span className={`run-by run-by--${runBy}`} data-testid={testId ?? "run-by"} data-run-by={runBy}>
      <span className={`run-by__ico run-by__ico--${runBy}`} aria-hidden="true" />
      <ResidentText>{t(runBy === "formal" ? "directory.runByFormal" : "directory.runByGrassroots")}</ResidentText>
    </span>
  );
}
