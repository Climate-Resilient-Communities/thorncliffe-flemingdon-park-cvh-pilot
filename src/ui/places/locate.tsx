"use client";

import "leaflet/dist/leaflet.css";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { BuildingList } from "@/contracts/buildingList";
import type { WhereRecord } from "@/contracts/placeSubmission";
import { PLACE_WHERE_TEXT_MAX_CHARS } from "@/contracts/placeSubmission";
import { useBasic } from "../basic";
import { sortBuildings } from "../choices/building-list";
import { ChoiceOption } from "../choices/parts";
import { Stack } from "../layout/stack";
import { createPinPicker } from "../map/leaflet-map";
import type { MiniMapTiles } from "../map/mini-map";
import { ResidentText } from "../text/resident-text";
import { AREA_CENTRE, nearestBuilding } from "./form-model";
import { Back, StepHeading } from "./parts";
import "../map/map.css";

type Mode = "pin" | "building" | "address" | "";

/**
 * The map of R-20: the resident moves it until the pin in its middle sits on the place. The pin is drawn by the page, not the map, so it is
 * always in the middle; the map tells where its centre is after each move. Leaflet loads in the browser only. When it cannot load (no signal,
 * a blocked tile server) the screen says so and the other two ways stay.
 */
function PinPicker({ tiles, start, onCentre }: { tiles: MiniMapTiles; start: { lat: number; lng: number }; onCentre: (at: { lat: number; lng: number }) => void }) {
  const t = useTranslations();
  const element = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // The first centre only: moving the map must not draw it again.
  const [from] = useState(start);
  // The latest callback, for the map's move handler, which is set up once.
  const report = useRef(onCentre);
  useEffect(() => {
    report.current = onCentre;
  });

  useEffect(() => {
    const at = element.current;
    if (!at) return;
    let live = true;
    let handle: { destroy(): void } | null = null;
    createPinPicker(at, tiles, from, { zoomIn: t("R14.zoomIn"), zoomOut: t("R14.zoomOut") }, (centre) => report.current(centre), controls.current ?? undefined)
      .then((made) => {
        if (!live) return made.destroy();
        handle = made;
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
      handle?.destroy();
    };
  }, [tiles, from, t]);

  if (failed) {
    return (
      <ResidentText as="p" className="choice-note" testId="places-map-failed">
        {t("places.mapFailed")}
      </ResidentText>
    );
  }
  return (
    <div className="map-frame">
      <div ref={controls} className="map-tools" dir="ltr" />
      {/* The map and its pin are laid out left to right in every language, as on R-14. */}
      <div className="places-pinmap" dir="ltr">
        <div ref={element} className="map-canvas" role="application" aria-label={t("R20.mapLabel")} tabIndex={0} data-testid="places-pinmap" />
        <span className="places-pinmap__pin" aria-hidden="true" />
      </div>
      <p className="map-credit" lang="en" dir="ltr">
        {tiles.attributionUrl ? (
          <a href={tiles.attributionUrl} target="_blank" rel="noopener noreferrer">
            {tiles.attribution}
          </a>
        ) : (
          tiles.attribution
        )}
      </p>
    </div>
  );
}

/**
 * R-20 "Where is it?": a pin on the map, one of the pilot's buildings (with where in it), or a street address, and "You do not need a street
 * address". The prototype's fourth way, a landmark, is left out: the pilot has no reviewed list of landmarks. In simpler view there is no map
 * (as R-14), so the pin is not offered. "Use this place" hands the place back to R-19; Back returns without changing it.
 */
export function LocateStep({
  tiles,
  where,
  buildings,
  home,
  onUse,
  onBack,
}: {
  tiles: MiniMapTiles | null;
  where: WhereRecord | null;
  buildings: BuildingList["buildings"] | null;
  home: { lat: number; lng: number } | null;
  onUse: (where: WhereRecord) => void;
  onBack: () => void;
}) {
  const t = useTranslations();
  const basic = useBasic();
  const pinOffered = tiles !== null && !basic;
  const [mode, setMode] = useState<Mode>(where?.kind === "pin" && !pinOffered ? "" : (where?.kind ?? ""));
  const [centre, setCentre] = useState<{ lat: number; lng: number }>(where?.kind === "pin" ? where : (home ?? AREA_CENTRE));
  const [rsn, setRsn] = useState(where?.kind === "building" ? where.rsn : "");
  const [inside, setInside] = useState(where?.kind === "building" ? (where.text ?? "") : "");
  const [address, setAddress] = useState(where?.kind === "address" ? where.text : "");

  const near = mode === "pin" && buildings ? nearestBuilding(buildings, centre) : null;
  let chosen: WhereRecord | null = null;
  let need = "";
  if (mode === "pin") chosen = { kind: "pin", lat: centre.lat, lng: centre.lng };
  else if (mode === "building") {
    if (rsn) chosen = { kind: "building", rsn, text: inside.trim() || null };
    else need = t("R20.needBuilding");
  } else if (mode === "address") {
    if (address.trim()) chosen = { kind: "address", text: address.trim() };
    else need = t("R20.needAddress");
  } else need = t("R20.needOne");

  const modes: { id: Exclude<Mode, "">; label: string }[] = [
    ...(pinOffered ? [{ id: "pin" as const, label: t("R20.pin") }] : []),
    { id: "building", label: t("R20.building") },
    { id: "address", label: t("R20.address") },
  ];

  return (
    <Stack gap="section-resident" testId="places-locate">
      <Back onClick={onBack} />
      <Stack gap="related">
        <StepHeading>{t("R20.title")}</StepHeading>
        <ResidentText as="p" className="signup-lead">
          {t("R20.noAddress")}
        </ResidentText>
      </Stack>
      <fieldset className="choice-fieldset">
        <ResidentText as="legend" className="choice-legend">
          {t("R20.howTitle")}
        </ResidentText>
        <Stack gap="label">
          {modes.map((m) => (
            <ChoiceOption key={m.id} kind="radio" name="places-where" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} label={m.label} testId={`places-where-${m.id}`} />
          ))}
        </Stack>
      </fieldset>

      {mode === "pin" && tiles && (
        <Stack gap="related">
          <ResidentText as="p" className="choice-hint">
            {t("R20.pinHint")}
          </ResidentText>
          <PinPicker tiles={tiles} start={centre} onCentre={setCentre} />
          {near && (
            <p className="choice-hint" role="status" data-testid="places-pin-near">
              <ResidentText>{t("R20.pinWhere", { place: near.address })}</ResidentText>
            </p>
          )}
        </Stack>
      )}

      {mode === "building" && (
        <Stack gap="related">
          <div className="signup-field">
            <label className="choice-legend" htmlFor="places-building">
              <ResidentText>{t("R20.building")}</ResidentText>
            </label>
            <select id="places-building" className="choice-input" value={rsn} onChange={(event) => setRsn(event.target.value)} data-testid="places-building">
              <option value="">{t("R20.buildingChoose")}</option>
              {sortBuildings(buildings ?? []).map((building) => (
                <option key={building.rsn} value={building.rsn}>
                  {building.address}
                </option>
              ))}
            </select>
          </div>
          <div className="signup-field">
            <label className="choice-legend" htmlFor="places-inside">
              <ResidentText>{t("R20.described")}</ResidentText> <span className="signup-tag">{t("R19.optional")}</span>
            </label>
            <input
              id="places-inside"
              className="choice-input"
              type="text"
              maxLength={PLACE_WHERE_TEXT_MAX_CHARS}
              value={inside}
              onChange={(event) => setInside(event.target.value)}
              aria-describedby="places-inside-hint"
            />
            <p className="choice-hint hide-basic" id="places-inside-hint">
              <ResidentText>{t("R20.describedHint")}</ResidentText>
            </p>
          </div>
        </Stack>
      )}

      {mode === "address" && (
        <div className="signup-field">
          <label className="choice-legend" htmlFor="places-address">
            <ResidentText>{t("R20.address")}</ResidentText>
          </label>
          <input
            id="places-address"
            className="choice-input"
            type="text"
            maxLength={PLACE_WHERE_TEXT_MAX_CHARS}
            autoComplete="street-address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            aria-describedby="places-address-hint"
            data-testid="places-address"
          />
          <p className="choice-hint" id="places-address-hint">
            <ResidentText>{t("R20.addressHint")}</ResidentText>
          </p>
        </div>
      )}

      {need && (
        <p className="choice-hint" role="status" data-testid="places-where-need">
          <ResidentText>{need}</ResidentText>
        </p>
      )}
      <button type="button" className="choice-btn choice-btn--primary tap signup-send" disabled={!chosen} onClick={() => chosen && onUse(chosen)} data-testid="places-where-use">
        <ResidentText>{t("R20.use")}</ResidentText>
      </button>
    </Stack>
  );
}
