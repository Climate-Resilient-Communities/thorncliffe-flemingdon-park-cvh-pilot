import { Screen, Stack } from "@/ui";
import type { SenderBannerView } from "./senderBanner";

/**
 * "Sending is failing" (S06.07): shown to everyone at the Hub, above each Hub screen, from the moment the health job finds texts stuck in the
 * queue or no sender running until it finds them clear. It is a status, written out in words (never colour alone), and says that the texts to the
 * on-call Admins may be late too: this banner, and the `ops_event` the health job writes, are the record when the text itself cannot go.
 */
export function SenderBanner({ view }: { view: SenderBannerView }) {
  return (
    <Screen surface="staff">
      <div role="status" className="hub-flag" data-testid="sender-failing-banner">
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
