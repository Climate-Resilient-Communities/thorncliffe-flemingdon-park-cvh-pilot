"use client";

import { useTranslations } from "next-intl";
import { Screen, Stack } from "@/ui";
import { Not911 } from "@/ui/emergency";

/**
 * What a resident sees when a page of the resident surface throws (the layout's header and navigation stay): the shell's
 * 911 block, so no page can fail into a screen that does not tell a resident to call 911 (AR-27). The words come from the
 * layout's NextIntlClientProvider, which sends the browser the `x01` group and nothing else. The error itself is never
 * shown (it may name the database); the server has already logged it.
 */
export default function ResidentError() {
  const x01 = useTranslations("x01");
  return (
    <Screen surface="resident" testId="resident-error">
      <Stack gap="related">
        <Not911 variant="block" t={(key) => x01(key)} />
      </Stack>
    </Screen>
  );
}
