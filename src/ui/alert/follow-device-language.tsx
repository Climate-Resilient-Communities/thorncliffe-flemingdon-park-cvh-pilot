"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isLaunchCode, type LaunchCode } from "@/i18n/languages";
import { useChoices } from "../choices/use-choices";

/**
 * The language of the phone's own choice for a shared link (S05.08): `/a/{slug}?l={lang}` opens in the language of the person who shared it, so the link reads
 * in something at once and the preview is in that language; once the page has loaded and the phone has been read, a phone that has a saved language moves to the
 * same alert in it (R-07, `replace`, so Back does not return to the other language). A phone with no saved language, or one saved as the page's own, stays. Traditional
 * Chinese is a conversion of the `zh` pages (D-5), so it moves to `zh`. The saved choice stays on the phone: nothing is asked of the server but the page itself.
 */
export function FollowDeviceLanguage({ lang, slug }: { lang: LaunchCode; slug: string }) {
  const router = useRouter();
  const saved = useChoices()?.lang;
  const target = saved === "zh-Hant" ? "zh" : saved;
  useEffect(() => {
    if (target !== undefined && isLaunchCode(target) && target !== lang) router.replace(`/${target}/alerts/${slug}`);
  }, [target, lang, slug, router]);
  return null;
}
