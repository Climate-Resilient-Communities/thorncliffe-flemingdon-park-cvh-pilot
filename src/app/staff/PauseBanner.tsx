import { Screen, Stack } from "@/ui";
import type { PauseBannerView } from "./pauseBanner";

/**
 * "Texts are paused" (S06.06): shown to everyone at the Hub, above each Hub screen, from the moment an Admin pauses until texts are resumed:
 * who paused, when and why. It is a status, written out in words (never colour alone); an Admin also gets the link to resume.
 */
export function PauseBanner({ view }: { view: PauseBannerView }) {
  return (
    <Screen surface="staff">
      <div role="status" className="hub-flag" data-testid="texts-paused-banner">
        <Stack gap="subline">
          <p>
            <strong className="hub-flag__label">{view.heading}</strong>
          </p>
          <p>{view.by}</p>
          <p>{view.why}</p>
          {view.resume ? (
            <p>
              <a className="hub-link tap" href={view.resume.href}>
                {view.resume.label}
              </a>
            </p>
          ) : null}
        </Stack>
      </div>
    </Screen>
  );
}
