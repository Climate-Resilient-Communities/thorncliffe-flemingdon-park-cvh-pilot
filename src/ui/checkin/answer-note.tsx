"use client";

import { useTranslations } from "next-intl";
import type { CheckinAnswer } from "@/contracts/checkin";
import { withIsolated } from "../text/isolated";
import { ResidentText } from "../text/resident-text";
import "./checkin.css";

/**
 * What became of a check-in request, as the form that sent it says it (S08.05; E08 "Personalised check-in responses": read from that POST's
 * own no-store answer, never stored or sent anywhere). The sign-up: saved until YES, or "No ambassador covers your floor yet. Call the Hub at
 * {number}". The edit page: saved, its method changed, withdrawn, or the same uncovered floor. The Hub's number is a `tel:` link.
 */
export function CheckinAnswerNote({ answer, page, hub, testId }: { answer: CheckinAnswer; page: "signup" | "edit"; hub: string; testId: string }) {
  const t = useTranslations("checkin");
  const r33 = useTranslations("R33");
  if (answer === "uncovered") {
    return (
      <p className="checkin-answer" role="status" data-testid={testId} data-answer={answer}>
        {withIsolated((number) => t("uncovered", { hub: number }), <a className="checkin-link" href={`tel:${hub.replace(/[^0-9+]/g, "")}`}>{hub}</a>)}
      </p>
    );
  }
  const words = { requested: page === "signup" ? t("untilYes") : t("savedRequested"), method_changed: t("savedMethod"), withdrawn: r33("withdrawn") }[answer];
  return (
    <ResidentText as="p" className="checkin-answer" testId={testId}>
      {words}
    </ResidentText>
  );
}
