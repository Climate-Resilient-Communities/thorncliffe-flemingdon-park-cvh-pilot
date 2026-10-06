// The numbered text menus (S07.05, AD-9; E07 definitions "Menu", "Building change by text", "Reply 0"): S07.04's `MenuPort` behind the
// inbound router, run in its transaction under the number's lock. The rules (the lists, their pages, what a reply does) are
// domain/menus.ts; here they meet the database and the outbox.
//
//  - Reply 1 or 2 starts a menu when the number has started fewer than 5 today (a keyed hash of the number per start in `rate_limit`, scope
//    `sms_menu`, Toronto's day). At the limit the reply says so and gives the Hub's number; once the edit link exists (S07.06 wires an
//    `EditLinkPort` that is `available`) it offers the link too ("Reply 1 for a link"), with the `edit_link_offer` prompt open for 10
//    minutes, and a 1 in that time calls the port's `send`. With the link, a menu closed by 0 at its first step offers it the same way
//    ("Menu closed. Nothing was changed. Reply 1 for a link", S07.06): the step every resident can reach to ask for a link.
//  - A page is sent (purpose `menu_reply`) and kept as the subscriber's `sms_prompt`: `kind` the menu, `step` the page and its options,
//    kept an hour and open for 10 minutes after it was sent. The building whose floors a reply may need is read with places' share lock,
//    so an Admin's floor edit waits until the reply is handled and the floor chosen is still there when it is saved.
//  - The last step changes the subscriber under its row lock (an edit's FOR NO KEY UPDATE, `lockForEdit`: it waits for an approval capturing
//    recipients, as S07.07 asks of every edit of a subscriber, while a resend still reads the resident as receiving). Menu 1 first asks
//    checkins (`locationChanging`, E08's "Changed location", a no-op until S08.05) before it takes that lock, so that E08 can lock in its
//    own order, then replaces every saved place with the building and floor chosen (no floor: the whole building), sets the neighbourhood
//    to the building's, and confirms (adding the check-in request's withdrawal when there was one). Menu 2 sets the language and confirms
//    in the new language.
//  - Reply 3 asks checkins to withdraw the request (`withdrawRequest`, E08) and says what happened: "You have no check-in request" until E08.
//
// Every reply is a catalog text in the subscriber's language that fits one segment (menuTexts.test.ts renders each, and every real page).
// Nothing here logs, audits or stores a number or a body: the router's log line names the keyword, the state and the action only.
import type { LaunchCode } from "../../../i18n/languages";
import { residentText, type ResidentTextName } from "../../../i18n/residentTexts";
import type { DbTransaction } from "../../../platform/db";
import { uuidv7 } from "../../../platform/ids";
import type { DeliveryResult, Enqueued, TransactionalInput } from "../../messaging";
import { floorsOfBuilding, listBuildings, streetOf } from "../../places";
import { inboundStore, type InboundStore } from "../adapters/inboundStore";
import { subscriberStore, type SubscriberStore } from "../adapters/subscriberStore";
import {
  EDIT_LINK_OFFER_KIND,
  EDIT_LINK_OFFER_MS,
  HUB_NUMBER,
  MENUS_PER_DAY,
  MENU_KEPT_MS,
  MENU_SCOPE,
  answerMenu,
  floorsWanted,
  readMenu,
  startBuildingMenu,
  startLanguageMenu,
  type Menu,
  type MenuFloor,
  type MenuMove,
  type MenuWorld,
} from "../domain/menus";
import { noCheckinRequestsYet, queueReply, smsOf, type CheckinRequests, type MenuPort, type MenuSubscriber } from "./inbound";

/**
 * Port: the edit link (S07.06): a single-use web link, sent by text, to change choices or delete the subscription. Until S07.06 there is
 * none (`available` false) and the reply at the daily menu limit gives the Hub's number only (`smsTexts.menuLimit`). S07.06 wires one that
 * is available: that reply then offers the link as well ("Reply 1 for a link", `smsTexts.menuLimitLink`) with the `edit_link_offer` prompt
 * open for 10 minutes, and a 1 in that time calls `send`, which makes the link and queues its text (purpose `edit_link`) in the router's
 * transaction. A menu closed with nothing changed then offers it too (`smsTexts.menuClosedLink`, the same prompt). S07.06's
 * `createEditLink(...).port` is the one the app wires.
 */
export interface EditLinkPort {
  readonly available: boolean;
  send(tx: DbTransaction, subscriber: { id: string; lang: LaunchCode }): Promise<void>;
}

export const noEditLinkYet: EditLinkPort = { available: false, send: async () => undefined };

/** Port: what the building menu reads of places: every pilot building, and a building's floors (null: no such building). */
export interface MenuPlaces {
  buildings(tx: DbTransaction): Promise<readonly { rsn: string; address: string; neighbourhoodId: string }[]>;
  floorsOf(tx: DbTransaction, rsn: string, options: { lock: "share" }): Promise<readonly MenuFloor[] | null>;
}

/** places' own readers (subscriptions may import places, AD-2). */
export const placesForMenus: MenuPlaces = {
  buildings: (tx) => listBuildings(tx),
  floorsOf: (tx, rsn, options) => floorsOfBuilding(tx, rsn, options),
};

export interface MenuDeps {
  /** messaging's `enqueueTransactional`. */
  enqueue: (tx: DbTransaction, input: TransactionalInput) => Promise<DeliveryResult<Enqueued>>;
  pricePerSegmentCents: () => number;
  places?: MenuPlaces;
  checkins?: CheckinRequests;
  editLink?: EditLinkPort;
  stores?: { subscribers?: SubscriberStore; inbound?: InboundStore };
  newId?: () => string;
}

/** Whether a text fits one segment, as messaging's encoder counts the body it would send (normalised, `SmartEncoded=false`). */
export const fitsOneText = (text: string): boolean => smsOf(text).segments === 1;

export function createMenus(deps: MenuDeps): MenuPort {
  const places = deps.places ?? placesForMenus;
  const checkins = deps.checkins ?? noCheckinRequestsYet;
  const editLink = deps.editLink ?? noEditLinkYet;
  const subscribers = deps.stores?.subscribers ?? subscriberStore;
  const inbound = deps.stores?.inbound ?? inboundStore;
  const newId = deps.newId ?? (() => uuidv7());

  /** Queues a reply to the subscriber in `lang` (its language unless given), as the router queues its own (`queueReply`). */
  async function say(tx: DbTransaction, subscriber: { id: string; lang: LaunchCode }, text: string, lang: LaunchCode = subscriber.lang): Promise<true> {
    await queueReply(deps, tx, { purpose: "menu_reply", recipient: { kind: "subscriber", id: subscriber.id }, nonce: newId(), lang, text });
    return true;
  }
  const sayText = (tx: DbTransaction, subscriber: MenuSubscriber, name: ResidentTextName, values: Record<string, string> = {}) =>
    say(tx, subscriber, residentText(subscriber.lang, name, values));

  /** What a menu reads: the buildings (menu 1 only) and the floors of `rsns`, each building's row share-locked until the transaction ends. */
  async function worldOf(tx: DbTransaction, lang: LaunchCode, menu: Menu["kind"], rsns: readonly string[]): Promise<MenuWorld> {
    const buildings =
      menu === "menu_building" ? (await places.buildings(tx)).map((building) => ({ rsn: building.rsn, address: building.address, neighbourhoodId: building.neighbourhoodId, ...streetOf(building.address) })) : [];
    const floors = new Map<string, readonly MenuFloor[]>();
    for (const rsn of rsns) {
      const found = await places.floorsOf(tx, rsn, { lock: "share" });
      if (found) floors.set(rsn, found.map(({ id, label }) => ({ id, label })));
    }
    return { lang, buildings, floors, fits: fitsOneText };
  }

  /** Menu 1's last step: one building, and a floor or none, replaces every saved place. */
  async function saveBuilding(tx: DbTransaction, subscriber: MenuSubscriber, move: { rsn: string; floorId: string | null }, world: MenuWorld): Promise<boolean> {
    // The domain picked the building from `world.buildings` and checked the floor against `world.floors`, read under the building's lock.
    const building = world.buildings.find((candidate) => candidate.rsn === move.rsn)!;
    const floor = move.floorId === null ? null : world.floors.get(move.rsn)!.find((candidate) => candidate.id === move.floorId)!;
    // E08 first, before the subscriber's row is locked here: it locks the round threads' `alert` rows before that row (its lock order).
    const withdrawal = await checkins.locationChanging(subscriber.id, [{ rsn: move.rsn, floorId: move.floorId }], tx);
    // Deleted meanwhile cannot happen under the number's lock (only this number's STOP deletes it); if it did, nothing is left to tell.
    if (!(await subscribers.lockForEdit(tx, subscriber.id))) return false;
    await subscribers.replacePlaces(tx, subscriber.id, [{ id: newId(), rsn: move.rsn, floorId: move.floorId }]);
    await subscribers.setNeighbourhood(tx, subscriber.id, building.neighbourhoodId);
    await subscribers.clearPrompt(tx, subscriber.id);
    if (floor) await sayText(tx, subscriber, "buildingSaved", { building: building.address, floor: floor.label });
    else await sayText(tx, subscriber, "buildingSavedWhole", { building: building.address });
    if (withdrawal === "withdrawn") await sayText(tx, subscriber, "checkinWithdrawn");
    return true;
  }

  /** Menu 2's last step: the language, confirmed in the new language. */
  async function saveLanguage(tx: DbTransaction, subscriber: MenuSubscriber, lang: LaunchCode): Promise<boolean> {
    if (!(await subscribers.lockForEdit(tx, subscriber.id))) return false;
    await subscribers.setLang(tx, subscriber.id, lang);
    await subscribers.clearPrompt(tx, subscriber.id);
    return say(tx, subscriber, residentText(lang, "languageSaved"), lang);
  }

  async function perform(tx: DbTransaction, subscriber: MenuSubscriber, move: MenuMove, world: MenuWorld, current: Menu | null): Promise<boolean> {
    switch (move.kind) {
      case "show":
        await subscribers.openNewPrompt(tx, subscriber.id, move.menu.kind, MENU_KEPT_MS, move.menu.step as Record<string, unknown>);
        return say(tx, subscriber, move.text);
      case "hub":
        // The menu stays on its page, and its 10 minutes start again.
        if (current) await subscribers.openNewPrompt(tx, subscriber.id, current.kind, MENU_KEPT_MS, current.step as Record<string, unknown>);
        return sayText(tx, subscriber, "menuHub", { hub: HUB_NUMBER });
      case "close":
        // S07.06: once the link exists, a menu closed with nothing changed offers it ("Reply 1 for a link"), with the same prompt as the
        // daily limit's offer: the menu step every resident can reach to ask for a link by text.
        if (editLink.available) {
          await subscribers.openNewPrompt(tx, subscriber.id, EDIT_LINK_OFFER_KIND, EDIT_LINK_OFFER_MS);
          return sayText(tx, subscriber, "menuClosedLink");
        }
        await subscribers.clearPrompt(tx, subscriber.id);
        return sayText(tx, subscriber, "menuClosed");
      case "save_building":
        return saveBuilding(tx, subscriber, move, world);
      case "save_language":
        return saveLanguage(tx, subscriber, move.lang);
    }
  }

  return {
    async start(tx, subscriber, choice) {
      if (choice === "3") {
        const withdrawal = await checkins.withdrawRequest(subscriber.id, tx);
        return sayText(tx, subscriber, withdrawal === "withdrawn" ? "checkinWithdrawn" : "noCheckinRequest");
      }
      if ((await inbound.startMenu(tx, MENU_SCOPE, subscriber.numberHash, MENUS_PER_DAY)) === "limit") {
        if (!editLink.available) return sayText(tx, subscriber, "menuLimit", { hub: HUB_NUMBER });
        await subscribers.openNewPrompt(tx, subscriber.id, EDIT_LINK_OFFER_KIND, EDIT_LINK_OFFER_MS);
        return sayText(tx, subscriber, "menuLimitLink", { hub: HUB_NUMBER });
      }
      if (choice === "2") {
        const world = await worldOf(tx, subscriber.lang, "menu_language", []);
        return perform(tx, subscriber, startLanguageMenu(world), world, null);
      }
      const world = await worldOf(tx, subscriber.lang, "menu_building", []);
      return perform(tx, subscriber, startBuildingMenu(world, await subscribers.savedBuildingCount(tx, subscriber.id)), world, null);
    },

    async answer(tx, subscriber, prompt, digit) {
      const menu = readMenu(prompt.kind, prompt.step);
      // A row this code cannot read (written by another version) closes the menu, as 0 at its first step would.
      if (menu === null) {
        await subscribers.clearPrompt(tx, subscriber.id);
        return sayText(tx, subscriber, "menuClosed");
      }
      const world = await worldOf(tx, subscriber.lang, menu.kind, floorsWanted(menu, digit));
      return perform(tx, subscriber, answerMenu(menu, digit, world), world, menu);
    },

    reset: (tx, subscriber) => sayText(tx, subscriber, "menuReset"),

    async sendEditLink(tx, subscriber) {
      if (!editLink.available) return false;
      await editLink.send(tx, { id: subscriber.id, lang: subscriber.lang });
      return true;
    },
  };
}
