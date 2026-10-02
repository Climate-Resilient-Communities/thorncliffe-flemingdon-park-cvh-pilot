"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { BuildingList } from "@/contracts/buildingList";
import type { LaunchCode } from "@/i18n/languages";
import { Screen } from "../layout/screen";
import { Stack } from "../layout/stack";
import { withIsolated } from "../text/isolated";
import { ResidentText } from "../text/resident-text";
import { sortBuildings } from "./building-list";
import { baseChoices, choicesStore } from "./choices-store";
import { ChoiceButton, ChoiceOption, StepActions, type StepMode } from "./parts";
import { useBuildingList, useChoices } from "./use-choices";

const textMatches = (text: string, query: string) => text.toLowerCase().includes(query.trim().toLowerCase());

/**
 * R-35: where I live. The resident picks one or more of the pilot buildings (their own or a relative's) and, for
 * each, optionally floors, with no limit. Buildings are saved by `rsn` and floors by floor id, on the phone only. A
 * unit number is never asked. The list comes from the building list the phone loaded, which is the same for everyone.
 */
export function PlaceStep({ lang, mode }: { lang: LaunchCode; mode: StepMode }) {
  const t = useTranslations("R35");
  const shell = useTranslations("shell");
  const router = useRouter();
  const choices = useChoices();
  const { state, retry } = useBuildingList();
  const [query, setQuery] = useState("");
  const [draftBuildings, setDraftBuildings] = useState<readonly string[] | null>(null);
  const [draftFloors, setDraftFloors] = useState<readonly string[] | null>(null);
  const buildings = draftBuildings ?? choices?.buildings ?? [];
  const floors = draftFloors ?? choices?.floors ?? [];

  const list = state.status === "ready" ? state.list : null;
  const shown = useMemo(
    () => (list ? sortBuildings(list.buildings).filter((b) => query.trim() === "" || textMatches(b.address, query) || textMatches(b.neighbourhood, query)) : []),
    [list, query],
  );

  const toggleBuilding = (building: BuildingList["buildings"][number]) => {
    if (buildings.includes(building.rsn)) {
      setDraftBuildings(buildings.filter((rsn) => rsn !== building.rsn));
      const own = new Set(building.floors.map((floor) => floor.id));
      setDraftFloors(floors.filter((id) => !own.has(id)));
    } else {
      setDraftBuildings([...buildings, building.rsn]);
      setDraftFloors(floors);
    }
  };

  const toggleFloor = (id: string) => setDraftFloors(floors.includes(id) ? floors.filter((f) => f !== id) : [...floors, id]);

  const finish = (save: boolean) => {
    if (save || mode === "first-run") {
      choicesStore.update((current) => {
        const next = baseChoices(current);
        if (save) {
          // Only floors of the chosen buildings are kept.
          const allowed = new Set(list?.buildings.filter((b) => buildings.includes(b.rsn)).flatMap((b) => b.floors.map((f) => f.id)) ?? floors);
          next.buildings = [...buildings];
          next.floors = floors.filter((id) => allowed.has(id));
        }
        if (mode === "first-run") next.welcomed = true;
        return next;
      });
    }
    router.push(mode === "first-run" ? `/${lang}` : `/${lang}/choices`);
  };

  return (
    <Screen surface="resident" testId="step-place">
      <Stack gap="stack">
        <Stack gap="label">
          {mode === "first-run" && (
            <p className="choice-hint">
              <ResidentText>{t("step")}</ResidentText>
            </p>
          )}
          <ResidentText as="h1">{t("title")}</ResidentText>
          <ResidentText as="p">{t("lead")}</ResidentText>
          <ResidentText as="p">{t("manyLine")}</ResidentText>
          <p className="choice-hint" data-testid="no-unit">
            <ResidentText>{t("noUnit")}</ResidentText>
          </p>
        </Stack>

        {state.status === "loading" && (
          <p role="status" className="choice-hint">
            <ResidentText>{t("loading")}</ResidentText>
          </p>
        )}
        {state.status === "failed" && (
          <Stack gap="target">
            <p role="alert" className="choice-note" data-testid="list-failed">
              <ResidentText>{t("loadFailed")}</ResidentText>
            </p>
            <ChoiceButton variant="secondary" onClick={retry} testId="list-retry">
              {t("retry")}
            </ChoiceButton>
          </Stack>
        )}

        {list && (
          <Stack gap="target">
            <input
              className="choice-input"
              type="search"
              dir="auto"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("buildingSearch")}
              aria-label={t("buildingSearch")}
              data-testid="building-search"
            />
            <p role="status" className="choice-hint" data-testid="chosen-count">
              <ResidentText>{buildings.length === 0 ? t("chosenNone") : buildings.length === 1 ? t("chosenOne") : t("chosenMany", { n: buildings.length })}</ResidentText>
            </p>
            {shown.length === 0 && query.trim() !== "" && (
              <p className="choice-hint" data-testid="no-match">
                {withIsolated((q) => t("noMatch", { q }), query.trim(), "auto")}
              </p>
            )}
            <Stack gap="target" as="ul" testId="building-options">
              {shown.map((building) => {
                const chosen = buildings.includes(building.rsn);
                return (
                  <li key={building.rsn} data-rsn={building.rsn}>
                    <Stack gap="target">
                      <ChoiceOption
                        kind="checkbox"
                        name="buildings"
                        value={building.rsn}
                        checked={chosen}
                        onChange={() => toggleBuilding(building)}
                        label={building.address}
                        line={building.neighbourhood}
                        isolate
                        testId={`building-${building.rsn}`}
                      />
                      {chosen && (
                        <fieldset className="choice-fieldset choice-floors" data-testid={`floors-${building.rsn}`}>
                          <legend className="choice-legend">
                            {withIsolated((address) => t("floorsIn", { building: address }), building.address)}
                          </legend>
                          {building.floors.length === 0 ? (
                            <p className="choice-hint">
                              <ResidentText>{t("noFloorsListed")}</ResidentText>
                            </p>
                          ) : (
                            <Stack gap="target" as="ul">
                              {building.floors.map((floor) => (
                                <li key={floor.id}>
                                  <ChoiceOption
                                    kind="checkbox"
                                    name="floors"
                                    value={floor.id}
                                    checked={floors.includes(floor.id)}
                                    onChange={() => toggleFloor(floor.id)}
                                    label={withIsolated((n) => t("floorN", { n }), floor.label)}
                                    testId={`floor-${floor.id}`}
                                  />
                                </li>
                              ))}
                            </Stack>
                          )}
                          <p className="choice-hint">
                            <ResidentText>{t("floorLine")}</ResidentText>
                          </p>
                        </fieldset>
                      )}
                    </Stack>
                  </li>
                );
              })}
            </Stack>
          </Stack>
        )}

        {mode === "first-run" ? (
          <Stack gap="label">
            <StepActions>
              <ChoiceButton variant="secondary" onClick={() => finish(false)} testId="step-skip">
                {shell("skip")}
              </ChoiceButton>
              <ChoiceButton variant="primary" onClick={() => finish(true)} testId="step-continue">
                {shell("next")}
              </ChoiceButton>
            </StepActions>
            <p className="choice-hint">
              <ResidentText>{t("skipLine")}</ResidentText>
            </p>
          </Stack>
        ) : (
          <StepActions>
            <ChoiceButton variant="secondary" onClick={() => finish(false)} testId="step-cancel">
              {shell("cancel")}
            </ChoiceButton>
            <ChoiceButton variant="primary" onClick={() => finish(true)} testId="step-save">
              {t("save")}
            </ChoiceButton>
          </StepActions>
        )}
      </Stack>
    </Screen>
  );
}
