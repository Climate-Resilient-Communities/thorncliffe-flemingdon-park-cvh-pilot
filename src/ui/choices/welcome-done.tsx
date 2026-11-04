"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import type { LaunchCode } from "@/i18n/languages";
import { Screen } from "../layout/screen";
import { Stack } from "../layout/stack";
import { Isolated, withIsolated } from "../text/isolated";
import { ResidentText } from "../text/resident-text";
import { useBuildingList, useChoices } from "./use-choices";

/**
 * The end of the first run (R-35 finished, prototype R35_WhereILive "You chose"): what the resident chose in plain words, that it
 * is kept on this phone only, a way to change it (R-34), then the invitation to text alerts (R-05) or straight to Alerts. The
 * choices are read from the phone; nothing is sent.
 */
export function WelcomeDone({ lang }: { lang: LaunchCode }) {
  const t = useTranslations("R35");
  const told = useTranslations("R34");
  const groupText = useTranslations("groups");
  const choices = useChoices();
  const { state } = useBuildingList((choices?.buildings ?? []).length > 0);
  const list = state.status === "ready" ? state.list : null;

  const buildings = choices?.buildings ?? [];
  const floors = choices?.floors ?? [];
  const groups = (choices?.groups ?? []).filter((group) => group !== "checkin");
  const checkin = (choices?.groups ?? []).includes("checkin");
  const nothing = choices !== undefined && buildings.length === 0 && groups.length === 0 && !checkin;

  return (
    <Screen surface="resident" testId="welcome-done">
      <Stack gap="section-resident">
        <Stack gap="related">
          <ResidentText as="h1">{t("finishedTitle")}</ResidentText>
          {nothing && <ResidentText as="p">{t("nothingSummary")}</ResidentText>}
          {choices !== undefined && !nothing && (
            <ul className="choice-done-list" data-testid="welcome-done-summary">
              {buildings.map((rsn) => {
                const listed = list?.buildings.find((b) => b.rsn === rsn);
                const chosenFloors = listed ? listed.floors.filter((floor) => floors.includes(floor.id)) : [];
                const name = listed ? <Isolated>{listed.address}</Isolated> : <ResidentText>{told("buildingByRsn", { rsn })}</ResidentText>;
                return (
                  <li key={rsn} data-testid={`welcome-done-building-${rsn}`}>
                    {name}
                    {chosenFloors.map((floor) => (
                      <span key={floor.id}>
                        {", "}
                        {withIsolated((n) => t("floorN", { n }), floor.label)}
                      </span>
                    ))}
                  </li>
                );
              })}
              {groups.map((group) => (
                <li key={group} data-testid={`welcome-done-group-${group}`}>
                  <ResidentText>{groupText(`${group}.label`)}</ResidentText>
                </li>
              ))}
              {checkin && (
                <li data-testid="welcome-done-checkin">
                  <ResidentText>{groupText("checkin.label")}</ResidentText>
                </li>
              )}
            </ul>
          )}
          <ResidentText as="p" className="choice-hint">
            {told("onDevice")}
          </ResidentText>
          <div>
            <Link className="choice-btn choice-btn--quiet tap" href={`/${lang}/choices`} prefetch={false} data-testid="welcome-done-change">
              <ResidentText>{t("changeAll")}</ResidentText>
            </Link>
          </div>
        </Stack>

        <section className="choice-told" aria-labelledby="welcome-done-texts" data-testid="welcome-done-invite">
          <h2 className="choice-told__key" id="welcome-done-texts">
            <ResidentText>{told("textAlerts")}</ResidentText>
          </h2>
          <ResidentText as="p">{t("invite")}</ResidentText>
          <div className="choice-actions">
            <Link className="choice-btn choice-btn--secondary tap" href={`/${lang}`} prefetch={false} data-testid="welcome-done-not-now">
              <ResidentText>{t("inviteNo")}</ResidentText>
            </Link>
            <Link className="choice-btn choice-btn--primary tap" href={`/${lang}/text-alerts`} prefetch={false} data-testid="welcome-done-texts-yes">
              <ResidentText>{t("inviteYes")}</ResidentText>
            </Link>
          </div>
        </section>
      </Stack>
    </Screen>
  );
}
