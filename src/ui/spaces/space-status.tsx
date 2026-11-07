"use client";

import { useTranslations } from "next-intl";
import { PURPOSE_KEYS, type OpenSpace } from "@/contracts/openSpaces";
import { ResidentText } from "../text/resident-text";
import { isUnconfirmedSpace, useOpenSpaces } from "./open-spaces";
import "./spaces.css";

type Translate = ReturnType<typeof useTranslations>;

/** "20 minutes", "3 hours", "2 days" in the page's language (the catalog's time words, translated in every launch language). */
export function elapsedWords(t: Translate, ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return minutes === 1 ? t("time.minute") : t("time.minutes", { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return hours === 1 ? t("time.hour") : t("time.hours", { n: hours });
  return t("time.days", { n: Math.round(hours / 24) });
}

/**
 * The status word of an open or full space as residents read it (the prototype's x09): "Open", "Full", or "Not confirmed" when nobody has
 * confirmed it for 4 hours, so a resident is never sent to a room on an old word.
 */
export function spaceStatusWord(t: Translate, space: OpenSpace, now: number = Date.now()): string {
  if (isUnconfirmedSpace(space, now)) return t("x09.unconfirmed");
  return t(space.status === "full" ? "x09.full" : "x09.open");
}

/** "Open as a space now for warming" (R14.spaceFor with the purpose's words, x09.purpose.*). */
export function spaceForWords(t: Translate, space: Pick<OpenSpace, "purpose">): string {
  return t("R14.spaceFor", { purpose: t(`x09.purpose.${PURPOSE_KEYS[space.purpose]}`) });
}

/**
 * A place's status as a space (the listing's R-12 status, the partner space of 2026-11-07): shown only when partners have the place open or
 * full as a space right now. The status as a word on a pill, what the space is for, and when it was confirmed, or, when nobody has for 4 hours,
 * "Not confirmed for 7 hours. It may not be open. Call before you go." Nothing at all when the place is not open as a space, or the list
 * cannot be loaded: no guess.
 */
export function SpaceStatus({ providerId }: { providerId: string }) {
  const t = useTranslations();
  const { spaces, at: now } = useOpenSpaces();
  const space = spaces.get(providerId);
  if (!space) return null;
  const unconfirmed = isUnconfirmedSpace(space, now);
  const age = elapsedWords(t, now - Date.parse(space.updated_at));
  const tone = unconfirmed ? "unconfirmed" : space.status;
  return (
    <section className={`space-status space-status--${tone}`} data-testid="space-status" data-status={tone}>
      <p className="space-status__head">
        <span className={`space-status__pill space-status__pill--${tone}`} data-testid="space-status-word">
          <ResidentText>{spaceStatusWord(t, space, now)}</ResidentText>
        </span>{" "}
        <ResidentText>{spaceForWords(t, space)}</ResidentText>
      </p>
      <ResidentText as="p" className="space-status__note">
        {unconfirmed ? t("x09.unconfirmedNote", { t: age }) : t("x09.confirmed", { t: t("time.ago", { t: age }) })}
      </ResidentText>
    </section>
  );
}
