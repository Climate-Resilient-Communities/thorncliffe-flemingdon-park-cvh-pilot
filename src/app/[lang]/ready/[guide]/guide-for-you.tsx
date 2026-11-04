"use client";

import Link from "next/link";
import { ResidentText, Stack } from "@/ui";
import { useChoices } from "@/ui/choices";

/**
 * "For you first" (the prototype's R-25 tailored block, UAT 2026-11-04): the lines of this guide's hazard for each group the resident
 * chose on R-26 (seniors, newcomers, families; a check-in is a visit, not advice), in R-26's order, before the full guide. The page is the
 * same for every visitor and is cached: it hands every group's lines to this block, which reads the groups from the phone and shows
 * the ones that fit. The lines say what to do, never who the resident is. Nothing is drawn while the phone has not been read, for a
 * resident with no group, or in basic mode (the prototype's cvh-hide-basic).
 */
export function GuideForYou({
  lang,
  lines,
  labels,
}: {
  lang: string;
  /** The catalog's `tailored.{hazard}.{group}` lines, by group, in R-26's order. */
  lines: readonly { group: string; lines: readonly string[] }[];
  labels: { forYou: string; tailoredLink: string };
}) {
  const choices = useChoices();
  const chosen: readonly string[] = choices?.groups ?? [];
  const shown = lines.filter((entry) => chosen.includes(entry.group)).flatMap((entry) => entry.lines.filter((line) => line.trim() !== ""));
  if (shown.length === 0) return null;
  return (
    <section className="guide-for-you hide-basic" aria-labelledby="guide-for-you-title" data-testid="guide-for-you">
      <Stack gap="related">
        <h2 id="guide-for-you-title">
          <ResidentText>{labels.forYou}</ResidentText>
        </h2>
        <ul className="guide-for-you__list">
          {shown.map((line) => (
            <li key={line} className="guide-for-you__item">
              <span className="shell-ico shell-ico--chevron shell-ico--mirror shell-ico--sm" aria-hidden="true" />
              <ResidentText>{line}</ResidentText>
            </li>
          ))}
        </ul>
        <Link href={`/${lang}/choices/groups`} prefetch={false} className="ready-link tap" data-testid="guide-for-you-choices">
          <ResidentText>{labels.tailoredLink}</ResidentText>
        </Link>
      </Stack>
    </section>
  );
}
