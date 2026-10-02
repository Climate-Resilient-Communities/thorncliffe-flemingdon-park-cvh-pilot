import { englishText } from "@/i18n/text";
import { Screen, Stack } from "@/ui";

/**
 * "Fewer than two usable Admins" (S01.06): shown to every Admin, above each staff screen, until two
 * Admins are usable again. Minimal until the Hub shell (S01.09) gives it its place.
 */
export function AdminShortfallBanner() {
  return (
    <Screen surface="staff">
      <div role="status">
        <Stack gap="related">
          <p>
            <strong>{englishText("staff.admins.shortfallBanner")}</strong>
          </p>
          <p>{englishText("staff.admins.shortfallLine")}</p>
        </Stack>
      </div>
    </Screen>
  );
}
