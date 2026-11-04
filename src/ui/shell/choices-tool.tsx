"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ResidentText } from "../text/resident-text";

/**
 * The header's "My choices" tool (C_ResidentHeader, R-34): the way to change the language, place, groups and text alerts from
 * any screen. The first-run steps (/welcome) do not draw it, as the prototype's first-run header does not: they are the
 * choices being made. On a narrow phone the words are read, not shown, beside the person mark.
 */
export function ChoicesTool({ lang, label }: { lang: string; label: string }) {
  const pathname = usePathname() ?? "";
  if (pathname.startsWith(`/${lang}/welcome`)) return null;
  const current = pathname.replace(/\/$/, "") === `/${lang}/choices` || pathname.startsWith(`/${lang}/choices/`);
  return (
    <Link className="shell-langbtn shell-choices-tool tap" href={`/${lang}/choices`} prefetch={false} aria-current={current ? "page" : undefined} data-testid="shell-choices">
      <span className="shell-ico shell-ico--person shell-ico--sm" aria-hidden="true" />
      <span className="shell-choices-tool__label">
        <ResidentText>{label}</ResidentText>
      </span>
    </Link>
  );
}
