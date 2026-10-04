import { Screen, Stack } from "@/ui";
import type { HealthBannerView } from "./healthBannerModel";

/**
 * The health banner (S06.07, S09.01): shown above each Hub screen from the moment the health job finds a condition until it finds it clear. Every
 * Admin and Coordinator sees each open condition named in plain words; everyone at the Hub sees "Sending is failing" while texts are stuck in the
 * queue or no sender is running. It is a status, written out in words (never colour alone): this banner, and the `ops_event` the health job
 * writes, are the record when the on-call text itself cannot go.
 */
export function HealthBanner({ view }: { view: HealthBannerView }) {
  return (
    <Screen surface="staff">
      <div role="status" className="hub-flag" data-testid="health-banner">
        <Stack gap="subline">
          <p>
            <strong className="hub-flag__label">{view.heading}</strong>
          </p>
          {view.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </Stack>
      </div>
    </Screen>
  );
}
