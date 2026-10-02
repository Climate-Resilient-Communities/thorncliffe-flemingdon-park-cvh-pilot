"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { GROUPS, type DeviceChoices, type Group } from "@/contracts/deviceChoices";
import type { LaunchCode } from "@/i18n/languages";
import { Screen } from "../layout/screen";
import { Stack } from "../layout/stack";
import { ResidentText } from "../text/resident-text";
import { baseChoices, choicesStore } from "./choices-store";
import type { StepLanguage } from "./language-step";
import { ChoiceButton } from "./parts";
import { useBuildingList, useChoices, useReconcileChoices } from "./use-choices";

function Told({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="choice-told" aria-labelledby={id} data-testid={id}>
      <p className="choice-told__key" id={id}>
        <ResidentText>{title}</ResidentText>
      </p>
      {children}
    </section>
  );
}

/** One saved item with its own Remove. */
function ToldRow({ label, caption, remove, removeText, removeLabel, testId }: { label: string; caption?: string; remove: () => void; removeText: string; removeLabel: string; testId: string }) {
  return (
    <div className="choice-told__row" data-testid={testId}>
      <div>
        <p className="choice-told__value">
          <ResidentText>{label}</ResidentText>
        </p>
        {caption !== undefined && (
          <p className="choice-hint">
            <ResidentText>{caption}</ResidentText>
          </p>
        )}
      </div>
      <div className="choice-told__acts">
        <ChoiceButton variant="quiet" onClick={remove} ariaLabel={removeLabel}>
          {removeText}
        </ChoiceButton>
      </div>
    </div>
  );
}

/**
 * R-34, "What I have told the CVH": every choice saved on this phone in plain words, each one changed or removed
 * where it is shown, and "Clear everything", which removes `cvh.choices` and starts again at R-01. When the phone
 * dropped a building or floor that is no longer in the building list, it says so here and that nothing else changed.
 */
export function MyChoices({ lang, languages }: { lang: LaunchCode; languages: readonly StepLanguage[] }) {
  const t = useTranslations("R34");
  const place = useTranslations("R35");
  const groupText = useTranslations("groups");
  const shell = useTranslations("shell");
  const router = useRouter();
  const choices = useChoices();
  const { state } = useBuildingList();
  useReconcileChoices(state);
  const [removedItem, setRemovedItem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (choices === undefined) {
    return (
      <Screen surface="resident" testId="my-choices">
        <ResidentText as="h1">{t("title")}</ResidentText>
      </Screen>
    );
  }

  const saved: DeviceChoices = choices ?? { v: 1 };
  const list = state.status === "ready" ? state.list : null;
  const buildings = saved.buildings ?? [];
  const floors = saved.floors ?? [];
  const groups: readonly Group[] = GROUPS.filter((group) => saved.groups?.includes(group));
  const language = languages.find(({ code }) => code === (saved.lang ?? lang)) ?? languages.find(({ code }) => code === lang)!;
  const removed = saved.removed && (saved.removed.buildings > 0 || saved.removed.floors > 0) ? saved.removed : null;
  const nothing = buildings.length === 0 && groups.length === 0;

  const change = (update: (current: DeviceChoices) => DeviceChoices, item: string) => {
    choicesStore.update((current) => update(baseChoices(current)));
    setRemovedItem(item);
  };

  const removeBuilding = (rsn: string, label: string) => {
    const own = new Set(list?.buildings.find((b) => b.rsn === rsn)?.floors.map((f) => f.id));
    change((c) => ({ ...c, buildings: buildings.filter((r) => r !== rsn), floors: floors.filter((id) => !own.has(id)) }), label);
  };

  const clearEverything = () => {
    choicesStore.clear();
    router.push(`/${lang}/welcome`);
  };

  return (
    <Screen surface="resident" testId="my-choices">
      <Stack gap="stack">
        <Stack gap="label">
          <ResidentText as="h1">{t("title")}</ResidentText>
          <ResidentText as="p">{t("lead")}</ResidentText>
        </Stack>

        {removed && (
          <div role="status" className="choice-note" data-testid="removed-note">
            <Stack gap="label">
              {removed.buildings > 0 && (
                <p className="choice-told__value">
                  <ResidentText>{removed.buildings === 1 ? t("removedBuildingOne") : t("removedBuildingMany", { n: removed.buildings })}</ResidentText>
                </p>
              )}
              {removed.floors > 0 && (
                <p className="choice-told__value">
                  <ResidentText>{removed.floors === 1 ? t("removedFloorOne") : t("removedFloorMany", { n: removed.floors })}</ResidentText>
                </p>
              )}
              <ResidentText as="p">{t("removedRest")}</ResidentText>
              <div className="choice-told__acts">
                <ChoiceButton variant="secondary" onClick={() => choicesStore.update((c) => (c ? { ...c, removed: undefined } : c))} testId="removed-ok">
                  {shell("ok")}
                </ChoiceButton>
              </div>
            </Stack>
          </div>
        )}

        {removedItem !== null && (
          <p role="status" className="choice-note" data-testid="removed-item">
            <ResidentText>{t("removedItem", { item: removedItem })}</ResidentText> <ResidentText>{t("removed")}</ResidentText>
          </p>
        )}

        {nothing && (
          <ResidentText as="p" testId="nothing-yet">
            {t("nothing")}
          </ResidentText>
        )}

        <Told id="told-language" title={t("language")}>
          <p className="choice-told__value" lang={language.bcp47} dir={language.dir} data-testid="told-language-value">
            {language.native}
          </p>
          <div className="choice-told__acts">
            <ChoiceButton variant="secondary" onClick={() => router.push(`/${lang}/choices/language`)} testId="change-language">
              {t("change")}
            </ChoiceButton>
          </div>
        </Told>

        <Told id="told-place" title={t("building")}>
          {buildings.length === 0 && (
            <p className="choice-told__value">
              <ResidentText>{t("buildingsNone")}</ResidentText>
            </p>
          )}
          {state.status === "loading" && buildings.length > 0 && (
            <p className="choice-hint">
              <ResidentText>{t("loading")}</ResidentText>
            </p>
          )}
          {state.status === "failed" && buildings.length > 0 && (
            <p className="choice-hint" data-testid="list-failed">
              <ResidentText>{t("listFailed")}</ResidentText>
            </p>
          )}
          {buildings.map((rsn) => {
            const listed = list?.buildings.find((b) => b.rsn === rsn);
            const label = listed?.address ?? t("buildingByRsn", { rsn });
            const chosenFloors = listed ? listed.floors.filter((floor) => floors.includes(floor.id)) : [];
            return (
              <div key={rsn} className="choice-told" data-testid={`told-building-${rsn}`}>
                <ToldRow
                  label={label}
                  caption={listed?.neighbourhood}
                  removeText={t("remove")}
                  removeLabel={t("removeItem", { item: label })}
                  remove={() => removeBuilding(rsn, label)}
                  testId={`told-building-row-${rsn}`}
                />
                {chosenFloors.map((floor) => {
                  const floorLabel = place("floorN", { n: floor.label });
                  return (
                    <ToldRow
                      key={floor.id}
                      label={floorLabel}
                      removeText={t("remove")}
                  removeLabel={t("removeItem", { item: `${label}, ${floorLabel}` })}
                      remove={() => change((c) => ({ ...c, floors: floors.filter((id) => id !== floor.id) }), `${label}, ${floorLabel}`)}
                      testId={`told-floor-${floor.id}`}
                    />
                  );
                })}
              </div>
            );
          })}
          {!list && floors.length > 0 && (
            <p className="choice-hint">
              <ResidentText>{floors.length === 1 ? t("floorsOne") : t("floorsMany", { n: floors.length })}</ResidentText>
            </p>
          )}
          <div className="choice-told__acts">
            <ChoiceButton variant="secondary" onClick={() => router.push(`/${lang}/choices/place`)} testId="change-place">
              {buildings.length === 0 ? t("whereLive") : t("change")}
            </ChoiceButton>
          </div>
        </Told>

        <Told id="told-groups" title={t("groups")}>
          {groups.length === 0 && (
            <p className="choice-told__value">
              <ResidentText>{t("groupsNone")}</ResidentText>
            </p>
          )}
          {groups.map((group) => {
            const label = groupText(`${group}.label`);
            return (
              <ToldRow
                key={group}
                label={label}
                removeText={t("remove")}
                  removeLabel={t("removeItem", { item: label })}
                remove={() => change((c) => ({ ...c, groups: groups.filter((g) => g !== group) }), label)}
                testId={`told-group-${group}`}
              />
            );
          })}
          <div className="choice-told__acts">
            <ChoiceButton variant="secondary" onClick={() => router.push(`/${lang}/choices/groups`)} testId="change-groups">
              {groups.length === 0 ? t("chooseGroups") : t("changeGroups")}
            </ChoiceButton>
          </div>
        </Told>

        <p className="choice-hint" data-testid="on-device">
          <ResidentText>{t("onDevice")}</ResidentText>
        </p>

        {confirming ? (
          <section className="choice-note" aria-labelledby="clear-title" data-testid="clear-confirm">
            <Stack gap="target">
              <h2 id="clear-title">
                <ResidentText>{t("clearTitle")}</ResidentText>
              </h2>
              <ResidentText as="p">{t("clearBody")}</ResidentText>
              <div className="choice-actions">
                <ChoiceButton variant="secondary" onClick={() => setConfirming(false)} testId="clear-cancel">
                  {shell("cancel")}
                </ChoiceButton>
                <ChoiceButton variant="danger" onClick={clearEverything} testId="clear-yes">
                  {t("clearYes")}
                </ChoiceButton>
              </div>
            </Stack>
          </section>
        ) : (
          <div className="choice-told__acts">
            <ChoiceButton variant="danger" onClick={() => setConfirming(true)} testId="clear-everything">
              {t("clearAll")}
            </ChoiceButton>
          </div>
        )}
      </Stack>
    </Screen>
  );
}
