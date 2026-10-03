import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { listProviders, torontoDate } from "@/modules/directory";
import { Screen, Stack } from "@/ui";
import { directoryDb } from "../directory";
import { staffPage } from "../guard";
import { ProviderList, type ProviderRowData } from "./ProviderList";
import { providerListLabels } from "./labels";

export const metadata: Metadata = { title: englishText("staff.providers.title") };

/** The page's heading and lead, shown to everyone who reaches it. */
function ProvidersHeading() {
  return (
    <Stack gap="related">
      <h1>{englishText("staff.providers.title")}</h1>
      <p>{englishText("staff.providers.lead")}</p>
    </Stack>
  );
}

/**
 * "Providers" (S02.04): the loaded catalogue, with each provider's state, its last-confirmed date
 * and the buttons to set that date and to publish or unpublish. The policy action `provider.manage`,
 * Admins only (S01.12), and its actions run at aal2 (S01.10); another role sees "Only an Admin can
 * change providers." and no list, and each action of the page refuses it on its own. Listing text is
 * shown nowhere on this page and edited nowhere: it changes only through the catalogue scripts (AD-11).
 * Responses are no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage(
  {
    route: "/staff/providers",
    access: "hub",
    action: "provider.manage",
    refused: () => (
      <Screen surface="staff">
        <Stack gap="section-hub">
          <ProvidersHeading />
          <p role="alert" className="hub-error">{englishText("staff.providers.errors.forbidden")}</p>
        </Stack>
      </Screen>
    ),
  },
  async () => {
    const providers = await listProviders(directoryDb());
    const rows: ProviderRowData[] = providers.map((p) => ({
      id: p.id,
      name: p.name,
      detail: [p.id, p.categories.join(", "), p.street].filter(Boolean).join(" · "),
      published: p.published,
      inCatalogue: p.inCatalogue,
      lastConfirmed: p.lastConfirmed,
    }));
    const inCatalogue = providers.filter((p) => p.inCatalogue);
    const summary = englishText("staff.providers.summary", {
      published: inCatalogue.filter((p) => p.published).length,
      total: inCatalogue.length,
      unconfirmed: inCatalogue.filter((p) => p.lastConfirmed === null).length,
    });
    return (
      <Screen surface="staff">
        <Stack gap="section-hub">
          <ProvidersHeading />
          {rows.length === 0 ? (
            <p>{englishText("staff.providers.empty")}</p>
          ) : (
            <>
              <p data-testid="provider-summary">{summary}</p>
              <ProviderList rows={rows} today={torontoDate(new Date())} labels={providerListLabels()} />
            </>
          )}
        </Stack>
      </Screen>
    );
  },
);
