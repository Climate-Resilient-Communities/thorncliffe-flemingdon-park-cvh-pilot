import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { listProviders, torontoDate } from "@/modules/directory";
import { Screen, Stack } from "@/ui";
import { directoryDb } from "../directory";
import { staffPage } from "../guard";
import { filterProviders, providerCounts, readProviderQuery } from "./filters";
import { ProviderFilters } from "./ProviderFilters";
import { ProviderList, type ProviderRowData } from "./ProviderList";
import { providerFiltersLabels, providerListLabels } from "./labels";

type Props = { searchParams?: Promise<{ filter?: string | string[]; q?: string | string[] }> };

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
 * "Providers" (S02.04): the loaded catalogue, with each provider's state, its last-confirmed date beside
 * the verified badge, the date field to set it and the actions menu to publish or unpublish. The filter
 * tabs (All, To confirm, Hidden) and the search by name or code are the page's query (?filter=&q=), so
 * they work without scripts. The policy action `provider.manage`,
 * Admins only (S01.12), and its actions run at aal2 (S01.10); another role sees "Only an Admin can
 * change providers." and no list, and each action of the page refuses it on its own. Listing text is
 * shown nowhere on this page and edited nowhere: it changes only through the catalogue scripts (AD-11).
 * Responses are no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage<Props>(
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
  async (_session, { searchParams }) => {
    const query = readProviderQuery((await searchParams) ?? {});
    const providers = await listProviders(directoryDb());
    const rows: ProviderRowData[] = providers.map((p) => ({
      id: p.id,
      name: p.name,
      detail: [p.id, p.categories.join(", "), p.street].filter(Boolean).join(" · "),
      published: p.published,
      inCatalogue: p.inCatalogue,
      lastConfirmed: p.lastConfirmed,
    }));
    const shown = filterProviders(rows, query);
    return (
      <Screen surface="staff">
        <Stack gap="section-hub">
          <ProvidersHeading />
          {rows.length === 0 ? (
            <p>{englishText("staff.providers.empty")}</p>
          ) : (
            <>
              <ProviderFilters query={query} counts={providerCounts(rows, query.q)} labels={providerFiltersLabels()} />
              <ProviderList
                rows={shown}
                today={torontoDate(new Date())}
                labels={providerListLabels()}
                empty={query.q === "" ? englishText("staff.providers.noneHere") : englishText("staff.providers.noMatch", { q: query.q })}
              />
            </>
          )}
        </Stack>
      </Screen>
    );
  },
);
