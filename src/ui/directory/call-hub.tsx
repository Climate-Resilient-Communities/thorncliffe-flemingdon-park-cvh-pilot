"use client";

import { useTranslations } from "next-intl";
import { withIsolated } from "../text/isolated";
import { HUB_PHONE, HUB_TEL } from "./contact";

/**
 * A call to the Hub, the number every "nothing here" state leads to (a filter that finds nothing, a directory that cannot
 * load). The number is one isolated left-to-right run that never breaks across lines, so the button stays one unit: it
 * wraps between "Call" and the number, not inside the number.
 */
export function CallHub({ testId }: { testId: string }) {
  const t = useTranslations();
  return (
    <a className="dir-call tap" href={HUB_TEL} data-testid={testId}>
      {withIsolated((phone) => t("R11.call", { phone }), HUB_PHONE)}
    </a>
  );
}
