"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ListingProvider } from "@/contracts/directory";
import type { LaunchCode } from "@/i18n/languages";
import { MiniMap, type MiniMapTiles } from "../map/mini-map";
import { inBounds, markerOf, NEIGHBOURHOODS_VIEW } from "../map/places";
import { isEnglishFallback, ResidentText } from "../text/resident-text";
import { Isolated } from "../text/isolated";
import { phoneEntries } from "./contact";
import { addressLines } from "./provider-view";

/**
 * Directions to a place in a new tab, from where the resident is (the service decides that, not the CVH). Opened only by the
 * resident's own click; nothing is sent before it.
 */
export const directionsHref = (lat: number, lng: number): string =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}`;

/**
 * The side panel of a provider's page on a desktop (desktop.css; it is not displayed on a phone, where the page is the one
 * column it was): the place on a small map of the whole area, its address, and the quick actions (call the first number,
 * directions, the map). Every action is also on the page itself or on the map page; the panel puts them beside the details.
 */
export function ProviderSide({ provider, lang, tiles }: { provider: ListingProvider; lang: LaunchCode; tiles: MiniMapTiles | null }) {
  const t = useTranslations();
  const place = provider.locations[0] ?? null;
  const address = addressLines(provider)[0] ?? null;
  const tel = phoneEntries(provider.contact.phone).find((entry) => entry.tel) ?? null;
  const call = t("R12.call");
  const onMap = place !== null && inBounds(place, NEIGHBOURHOODS_VIEW);

  return (
    <div className="provider-side" data-testid="provider-side">
      {tiles && place && onMap && <MiniMap tiles={tiles} lat={place.lat} lng={place.lng} marker={markerOf(provider).marker} />}
      {address && (
        <p className="provider-side__address" data-testid="provider-side-address">
          <Isolated>{address}</Isolated>
        </p>
      )}
      <ul className="provider-side__actions">
        {tel && (
          <li>
            <a className="dir-call tap" href={`tel:${tel.tel}`} data-testid="provider-side-call" {...(isEnglishFallback(call) ? { dir: "ltr", lang: "en" } : {})}>
              <ResidentText>{call}</ResidentText>{" "}
              <bdi dir="ltr" lang="en">
                {tel.text}
              </bdi>
            </a>
          </li>
        )}
        {place && (
          <li>
            <a className="dir-btn dir-btn--secondary tap" href={directionsHref(place.lat, place.lng)} target="_blank" rel="noopener noreferrer" data-testid="provider-side-directions">
              <ResidentText>{t("R12.directions")}</ResidentText>
            </a>
          </li>
        )}
        {onMap && (
          <li>
            <Link className="dir-link tap" href={`/${lang}/map`} prefetch={false} data-testid="provider-side-map">
              <ResidentText>{t("R12.onMap")}</ResidentText>
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}
