// Where an alert is, in words, for the share message and its link's preview (S05.08). Server only.
//
// A neighbourhood audience names the neighbourhoods; a buildings audience names the addresses of the first few buildings, which are read the way the building page
// reads them (one cached read each, shared by every visitor, dropped when the Hub changes a building). Alert pages never fail because a building could not be read:
// that building is left out, and with none named the message says nothing about the place rather than guessing one.
import type { FeedThread } from "@/contracts/feed";
import { languageOf, type LaunchCode } from "@/i18n/languages";
import { PLACE_ADDRESSES_SHOWN, placeLine, type Translate } from "@/ui/alert";
import { loadBuilding } from "../buildings/[rsn]/source";

export async function loadPlace(thread: FeedThread, lang: LaunchCode, t: Translate): Promise<string | null> {
  const { audience } = thread;
  const addresses = new Map<string, string>();
  if (audience.scope === "buildings") {
    await Promise.all(
      audience.buildings.slice(0, PLACE_ADDRESSES_SHOWN).map(async ({ rsn }) => {
        try {
          const found = await loadBuilding(rsn);
          if (found) addresses.set(rsn, found.address);
        } catch {
          // Left out: the alert is still told, without that address.
        }
      }),
    );
  }
  return placeLine(audience, addresses, languageOf(lang).bcp47, t);
}
