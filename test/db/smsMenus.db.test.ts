// The numbered text menus against a real database (S07.05), through the inbound router as src/app/inbound.ts composes it: reply 1 (street,
// building on it, floor or the whole building; the warning when more than one building is saved; the places replaced and the
// neighbourhood set only at the last step, with a confirmation), reply 2 (the language changed, confirmed in the new language), 0, 8 and 9
// on the pages, a menu idle for 10 minutes (the reply says it has reset and is read as a new keyword), the daily limit of 5 menus (the Hub's
// number; the edit link's offer once S07.06 wires it), reply 3 (checkins' withdrawRequest port: "You have no check-in request" until E08),
// E08's "Changed location" seam (called before the menu locks the subscriber's row), the edit's row lock (an approval's capture waits for
// it, a resend does not), a Twilio retry, digits in other scripts, and the grants the menus need. Every number is fictional
// (555-01xx) and nothing reaches Twilio.
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { createDeliveryQueue } from "../../src/modules/messaging";
import { floorsOfBuilding, listBuildings } from "../../src/modules/places";
import {
  HUB_NUMBER,
  MENU_SCOPE,
  clientHash,
  createInboundRouter,
  createMenus,
  subscriberReceives,
  type CheckinRequests,
  type EditLinkPort,
  type InboundMessage,
  type InboundOutcome,
  type InboundRouter,
  type MenuPlaces,
} from "../../src/modules/subscriptions";
import { countSms } from "../../src/modules/messaging";
import { createDb, type Db } from "../../src/platform/db";
import { BASE_URL, dispatcherWorld, type DispatcherWorld } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let world: DispatcherWorld;

const VERSION = "2026-10-02.1";
const KEY = "a-test-key-for-the-menu-limit";
const NUMBER = "+14165550161";
// Menu Street has two buildings (12 with floors G, 1 and 2; 14 with none) and Other Way one, in the other neighbourhood.
const RSN_12 = "9105001";
const RSN_14 = "9105002";
const RSN_OTHER = "9105003";
const RSNS = [RSN_12, RSN_14, RSN_OTHER];
const FLOOR_G = "0190f000-0000-7000-8000-000000510001";
const FLOOR_1 = "0190f000-0000-7000-8000-000000510002";
const FLOOR_2 = "0190f000-0000-7000-8000-000000510003";
const FLOOR_OTHER = "0190f000-0000-7000-8000-000000510004";

const routerLines: { evt: string; fields: Record<string, unknown> }[] = [];
let sid = 0;
const nextSid = () => `SM${(++sid + 0x5050).toString(16).padStart(32, "0")}`;

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  appSql = postgres(url.href, { max: 4, onnotice: () => {} });
  app = createDb(url.href);
  world = dispatcherWorld(owner, appSql, app);
  await owner`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H'), ('FP', 'Flemingdon Park', 'M3C') on conflict do nothing`;
  await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values
                (${RSN_12}, 'TP', '12 Menu Street', 43.7, -79.34, now()), (${RSN_14}, 'TP', '14 Menu Street', 43.7, -79.34, now()),
                (${RSN_OTHER}, 'FP', '3 Other Way', 43.72, -79.33, now()) on conflict do nothing`;
  await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${FLOOR_G}, ${RSN_12}, 'G', 0, true),
                (${FLOOR_1}, ${RSN_12}, '1', 1, true), (${FLOOR_2}, ${RSN_12}, '2', 2, true), (${FLOOR_OTHER}, ${RSN_OTHER}, '1', 1, false) on conflict do nothing`;
});

async function resetAll() {
  await owner`delete from subscriber`;
  await owner`delete from inbound_seen`;
  await owner`delete from inbound_keyword_count`;
  await owner`delete from rate_limit where scope in ('inbound', 'inbound_mute', ${MENU_SCOPE}, 'sms_edit_link')`;
  await owner`delete from inbound_limited_count`;
  await world.reset();
  routerLines.length = 0;
}

afterAll(async () => {
  await resetAll();
  await owner`delete from building_floor where rsn in ${owner(RSNS)}`;
  await owner`delete from building where rsn in ${owner(RSNS)}`;
  await app.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(resetAll);

/** places' real readers, the list kept to this file's buildings (other files' buildings may be in the database). */
const places: MenuPlaces = {
  buildings: async (tx) => (await listBuildings(tx)).filter((building) => RSNS.includes(building.rsn)),
  floorsOf: (tx, rsn, options) => floorsOfBuilding(tx, rsn, options),
};

/**
 * The router as src/app/inbound.ts composes it, with the menus on the real tables; checkins' and the edit link's ports can be faked, and
 * `onMenuReply` is called with each menu reply's body before it is queued, inside the menu's transaction (what other sessions see then).
 */
function routerOn(ports: { checkins?: CheckinRequests; editLink?: EditLinkPort; onMenuReply?: (body: string) => Promise<void> } = {}): InboundRouter {
  const queue = createDeliveryQueue();
  const { onMenuReply, ...menuPorts } = ports;
  return createInboundRouter({
    db: app,
    places: { floorIdsOf: async (executor, rsn) => (await floorsOfBuilding(executor, rsn))?.map((f) => f.id) ?? null },
    enqueue: (tx, input, now) => createDeliveryQueue(now ? { now: () => now } : {}).enqueueTransactional(tx, input),
    skipRecipientDeliveries: (tx, recipient) => queue.skipRecipientDeliveries(tx, recipient),
    menus: createMenus({
      enqueue: async (tx, input) => {
        await onMenuReply?.(input.body);
        return queue.enqueueTransactional(tx, input);
      },
      pricePerSegmentCents: () => 1.5,
      places,
      ...menuPorts,
    }),
    numberKey: () => KEY,
    publicBaseUrl: () => BASE_URL,
    pricePerSegmentCents: () => 1.5,
    log: { info: (evt, fields) => void routerLines.push({ evt, fields }) },
  });
}

const text = (body: string): InboundMessage => ({ messageSid: nextSid(), from: NUMBER, body, optOutType: null });
const send = (body: string, ports: Parameters<typeof routerOn>[0] = {}): Promise<InboundOutcome> => routerOn(ports).handle(text(body));

/** A subscriber made directly (S07.04's YES is tested there), with its saved places. */
async function subscriber(lang = "en", saved: { rsn: string; floorId: string | null }[] = [{ rsn: RSN_12, floorId: FLOOR_1 }]): Promise<string> {
  const id = crypto.randomUUID();
  await owner`insert into subscriber (id, phone, lang, neighbourhood_id, groups, consent_version, started_by) values (${id}, ${NUMBER}, ${lang}, 'TP', '{seniors}', ${VERSION}, 'web')`;
  for (const place of saved) await owner`insert into subscriber_place (id, subscriber_id, rsn, floor_id) values (${crypto.randomUUID()}, ${id}, ${place.rsn}, ${place.floorId})`;
  return id;
}

const replies = async () => (await owner`select purpose, lang, body, recipient_kind, segments from delivery where recipient_kind = 'subscriber' order by created_at, id`) as unknown as { purpose: string; lang: string; body: string; segments: number }[];
const lastReply = async () => (await replies()).at(-1)!;
const prompt = async () => (await owner`select kind, step, sent_at, expires_at from sms_prompt`)[0] ?? null;
const placesOf = async (id: string) => (await owner`select rsn, floor_id from subscriber_place where subscriber_id = ${id} order by rsn`).map((row) => ({ rsn: row.rsn as string, floorId: row.floor_id as string | null }));
const row = async (id: string) => (await owner`select lang, neighbourhood_id, groups from subscriber where id = ${id}`)[0]!;
/**
 * How the subscriber's row is locked, as another session finds it at once (NOWAIT): "free" when nothing holds it; "edit" when it is held
 * FOR NO KEY UPDATE (an approval's FOR SHARE capture would wait, a resend's FOR KEY SHARE would not); "delete" when it is held FOR UPDATE.
 */
async function rowLock(id: string): Promise<"free" | "edit" | "delete"> {
  const takes = (strength: string) =>
    owner.unsafe(`select id from subscriber where id = $1 for ${strength} nowait`, [id]).then(
      () => true,
      (error: { code?: string }) => (error.code === "55P03" ? false : Promise.reject(error as Error)),
    );
  if (await takes("share")) return "free";
  return (await takes("key share")) ? "edit" : "delete";
}

/** Moves the open prompt's message back in time, as if the resident had not replied for `minutes`. */
const idle = (minutes: number) => owner`update sms_prompt set sent_at = sent_at - ${minutes} * interval '1 minute', expires_at = expires_at - ${minutes} * interval '1 minute'`;

describe("the grants the menus need", () => {
  it("let the app change a subscriber's language and neighbourhood, and nothing else of it but the retention state, the groups (S07.06's page) and the terms version (S09.07's YES)", async () => {
    const [rights] = await owner`select has_column_privilege('cvh_app', 'subscriber', 'lang', 'update') as lang,
                                        has_column_privilege('cvh_app', 'subscriber', 'neighbourhood_id', 'update') as neighbourhood,
                                        has_column_privilege('cvh_app', 'subscriber', 'retention_state', 'update') as retention,
                                        has_column_privilege('cvh_app', 'subscriber', 'phone', 'update') as phone,
                                        has_column_privilege('cvh_app', 'subscriber', 'groups', 'update') as groups,
                                        has_column_privilege('cvh_app', 'subscriber', 'consent_version', 'update') as consent,
                                        has_column_privilege('cvh_app', 'subscriber', 'started_by', 'update') as started`;
    // S07.06's edit page changes the groups too (20261006150000_subscription_edit_token.sql); S09.07's re-consent (`campaignStore.retain`) sets
    // consent_version to the campaign's terms version.
    expect(rights).toEqual({ lang: true, neighbourhood: true, retention: true, phone: false, groups: true, consent: true, started: false });
    for (const role of ["anon", "authenticated"]) {
      const [any] = await owner`select has_column_privilege(${role}, 'subscriber', 'lang', 'update') as lang`;
      expect(any!.lang, role).toBe(false);
    }
  });

  it("lists the buildings with their address and neighbourhood, by address (places' reader for the menu)", async () => {
    const listed = (await app.transaction((tx) => listBuildings(tx))).filter((building) => RSNS.includes(building.rsn));
    expect(listed).toEqual([
      { rsn: RSN_12, address: "12 Menu Street", neighbourhoodId: "TP" },
      { rsn: RSN_14, address: "14 Menu Street", neighbourhoodId: "TP" },
      { rsn: RSN_OTHER, address: "3 Other Way", neighbourhoodId: "FP" },
    ]);
  });
});

describe("reply 1: building or floor", () => {
  it("goes street -> building on it -> floor and replaces the saved building only at the last step, with a confirmation", async () => {
    const id = await subscriber("en");
    expect(await send("1")).toEqual({ kind: "handled", keyword: "1", state: "active", action: "menu", replied: true });
    expect((await lastReply()).body).toBe("Your street:\n1) Menu Street\n2) Other Way\n0 Back 9 Hub");
    expect(await prompt()).toMatchObject({ kind: "menu_building", step: { stage: "street", saved: 1, page: 0, options: ["Menu Street", "Other Way"] } });
    // An hour is kept; the menu is open for 10 minutes of it.
    const open = (await prompt())!;
    expect((open.expires_at as Date).getTime() - (open.sent_at as Date).getTime()).toBe(60 * 60_000);

    expect(await send("1")).toMatchObject({ action: "menu_reply", replied: true });
    expect((await lastReply()).body).toBe("Your building:\n1) 12\n2) 14\n0 Back 9 Hub");
    expect(await send("1")).toMatchObject({ action: "menu_reply", replied: true });
    expect((await lastReply()).body).toBe("Your floor:\n1) Whole building\n2) G\n3) 1\n4) 2\n0 Back 9 Hub");
    // Nothing has changed yet.
    expect(await placesOf(id)).toEqual([{ rsn: RSN_12, floorId: FLOOR_1 }]);

    expect(await send("4")).toMatchObject({ action: "menu_reply", replied: true });
    expect(await placesOf(id)).toEqual([{ rsn: RSN_12, floorId: FLOOR_2 }]);
    expect(await row(id)).toMatchObject({ neighbourhood_id: "TP", lang: "en" });
    expect(await prompt()).toBeNull();
    expect((await lastReply()).body).toBe("Saved. Your building is now 12 Menu Street, floor 2.");

    // Every reply was a one-segment menu reply to the subscriber.
    const sent = await replies();
    expect(sent).toHaveLength(4);
    for (const reply of sent) expect(reply).toMatchObject({ purpose: "menu_reply", lang: "en", segments: 1 });
    expect(await owner`select keyword, count from inbound_keyword_count order by keyword`).toEqual([
      { keyword: "1", count: 3 },
      { keyword: "other", count: 1 },
    ]);
  });

  it("warns first when more than one building is saved: 0 there closes and changes nothing, 1 goes on, and the choice replaces them all", async () => {
    const id = await subscriber("en", [
      { rsn: RSN_12, floorId: FLOOR_G },
      { rsn: RSN_12, floorId: FLOOR_1 },
      { rsn: RSN_14, floorId: null },
    ]);
    await send("1");
    expect((await lastReply()).body).toBe("This replaces your 2 saved buildings. 1 Continue, 0 Back");
    expect(await send("0")).toMatchObject({ action: "menu_reply", replied: true });
    expect((await lastReply()).body).toBe("Menu closed. Nothing was changed.");
    expect(await prompt()).toBeNull();
    expect((await placesOf(id)).length).toBe(3);
    expect((await row(id)).lang).toBe("en");

    await send("1");
    await send("1"); // Continue
    expect((await lastReply()).body.startsWith("Your street:")).toBe(true);
    await send("2"); // Other Way
    expect((await lastReply()).body).toBe("Your building:\n1) 3\n0 Back 9 Hub");
    await send("1"); // 3 Other Way: its floors
    await send("1"); // the whole building
    expect(await placesOf(id)).toEqual([{ rsn: RSN_OTHER, floorId: null }]);
    // The building is in Flemingdon Park: the subscriber's neighbourhood follows it.
    expect((await row(id)).neighbourhood_id).toBe("FP");
    expect((await lastReply()).body).toBe("Saved. Your building is now 3 Other Way.");
  });

  it("saves a building with no floors at the building step, and goes back with 0 a step at a time", async () => {
    const id = await subscriber("en", []);
    await send("1");
    await send("1"); // Menu Street
    await send("0"); // back to the streets
    expect((await lastReply()).body.startsWith("Your street:")).toBe(true);
    await send("1");
    await send("2"); // 14 Menu Street has no floors: saved at once
    expect(await placesOf(id)).toEqual([{ rsn: RSN_14, floorId: null }]);
    expect((await lastReply()).body).toBe("Saved. Your building is now 14 Menu Street.");
  });

  it("gives the Hub's number on 9 and stays on the page, sends the page again for a reply that is not an option, and reads digits in any script", async () => {
    await subscriber("en");
    await send("1");
    await idle(4);
    const before = (await prompt())!;
    expect(await send("9")).toMatchObject({ action: "menu_reply", replied: true });
    expect((await lastReply()).body).toBe(`Call the Hub at ${HUB_NUMBER}.`);
    const after = (await prompt())!;
    expect(after.step).toEqual(before.step);
    // Its 10 minutes start again.
    expect((after.sent_at as Date).getTime()).toBeGreaterThan((before.sent_at as Date).getTime() + 3 * 60_000);

    for (const reply of ["7", "hello", "YES", "12"]) {
      expect(await send(reply), reply).toMatchObject({ action: "menu_reply", replied: true });
      expect((await lastReply()).body, reply).toBe("Your street:\n1) Menu Street\n2) Other Way\n0 Back 9 Hub");
    }
    // ۱ is Urdu's 1.
    await send("۱");
    expect((await lastReply()).body).toBe("Your building:\n1) 12\n2) 14\n0 Back 9 Hub");
  });

  it("reads 0 inside a menu as Back: it never opens the deletion's confirmation", async () => {
    const id = await subscriber("en");
    await send("1");
    await send("1");
    await send("0");
    await send("0");
    expect((await lastReply()).body).toBe("Menu closed. Nothing was changed.");
    expect(await row(id)).toBeDefined();
    expect((await replies()).some((reply) => reply.body.includes("within 10 minutes"))).toBe(false);
  });

  it("asks checkins first ('Changed location', E08), before the subscriber's row is locked and the places replaced, and adds the withdrawal to the confirmation", async () => {
    const id = await subscriber("en");
    const calls: { subscriberId: string; places: unknown; placesThen: unknown; rowThen: string }[] = [];
    const checkins: CheckinRequests = {
      withdrawRequest: async () => "none",
      locationChanging: async (subscriberId, places, tx) => {
        const placesThen = await tx.execute(`select rsn from subscriber_place where subscriber_id = '${subscriberId}'`);
        // E08's request lock order puts the round threads' `alert` rows before the subscriber row: the menu has not locked it yet.
        calls.push({ subscriberId, places, placesThen: [...placesThen].map((r) => (r as { rsn: string }).rsn), rowThen: await rowLock(subscriberId) });
        return "withdrawn";
      },
    };
    for (const reply of ["1", "1", "1", "2"]) await send(reply, { checkins });
    expect(calls).toEqual([{ subscriberId: id, places: [{ rsn: RSN_12, floorId: FLOOR_G }], placesThen: [RSN_12], rowThen: "free" }]);
    const sent = await replies();
    expect(sent.at(-2)!.body).toBe("Saved. Your building is now 12 Menu Street, floor G.");
    expect(sent.at(-1)!.body).toBe("Your check-in request is withdrawn.");
  });

  it("saves under an edit's row lock: an approval's capture waits for it, and a resend still finds the resident receiving (menus 1 and 2)", async () => {
    const id = await subscriber("en");
    const seen: { reply: string; row: string; receives: boolean }[] = [];
    const onMenuReply = async (body: string) => {
      if (!body.startsWith("Saved.") && !body.startsWith("Enregistré.")) return;
      // Another session, while the menu's transaction holds the row: the resend's check (FOR KEY SHARE SKIP LOCKED), and the lock itself.
      const receives = await app.transaction((other) => subscriberReceives(other, id));
      seen.push({ reply: body.split(" ")[0]!, row: await rowLock(id), receives });
    };
    for (const reply of ["1", "1", "1", "2"]) await send(reply, { onMenuReply });
    await send("2", { onMenuReply });
    let options = ((await prompt())!.step as { options: string[] }).options;
    while (!options.includes("fr")) {
      await send("8", { onMenuReply });
      options = ((await prompt())!.step as { options: string[] }).options;
    }
    await send(String(options.indexOf("fr") + 1), { onMenuReply });
    expect(seen).toEqual([
      { reply: "Saved.", row: "edit", receives: true },
      { reply: "Enregistré.", row: "edit", receives: true },
    ]);
    expect(await placesOf(id)).toEqual([{ rsn: RSN_12, floorId: FLOOR_G }]);
    expect((await row(id)).lang).toBe("fr");
    // Nothing holds the row once the menu's transaction is over.
    expect(await rowLock(id)).toBe("free");
  });

  it("does not save a floor an Admin removed after the page was sent: the page comes again as it now is", async () => {
    const id = await subscriber("en");
    for (const reply of ["1", "1", "1"]) await send(reply);
    await owner`delete from building_floor where id = ${FLOOR_2}`;
    try {
      await send("4");
      expect(await placesOf(id)).toEqual([{ rsn: RSN_12, floorId: FLOOR_1 }]);
      expect((await lastReply()).body).toBe("Your floor:\n1) Whole building\n2) G\n3) 1\n0 Back 9 Hub");
    } finally {
      await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${FLOOR_2}, ${RSN_12}, '2', 2, true) on conflict do nothing`;
    }
  });
});

describe("reply 2: language", () => {
  it("lists the 15 languages in their own names over pages, and the choice changes the language, confirmed in the new one", async () => {
    const id = await subscriber("ur");
    expect(await send("2")).toMatchObject({ action: "menu", replied: true });
    const first = await lastReply();
    expect(first.lang).toBe("ur");
    expect(first.body.startsWith("زبان:\n1) اردو\n2) پښتو")).toBe(true);
    // 8 until French is on the page, then its number.
    let options = ((await prompt())!.step as { options: string[] }).options;
    const seen = [...options];
    while (!options.includes("fr")) {
      await send("8");
      options = ((await prompt())!.step as { options: string[] }).options;
      seen.push(...options);
    }
    await send(String(options.indexOf("fr") + 1));
    expect((await row(id)).lang).toBe("fr");
    expect(await prompt()).toBeNull();
    const confirmation = await lastReply();
    expect(confirmation).toMatchObject({ lang: "fr", body: "Enregistré. Vous recevrez vos messages en français.", segments: 1 });
    expect(seen.slice(0, 5)).toEqual(["ur", "ps", "tl", "prs", "gu"]);
    // What comes next is in French.
    await send("3");
    expect(await lastReply()).toMatchObject({ lang: "fr", body: "Vous n'avez aucune demande de prise de nouvelles." });
  });
});

describe("a menu idle for 10 minutes", () => {
  it("has reset: the reply says so and is read as a new keyword (2 starts the language menu)", async () => {
    await subscriber("en");
    await send("1");
    await idle(11);
    expect(await send("2")).toMatchObject({ keyword: "2", action: "menu", replied: true });
    const sent = await replies();
    expect(sent.at(-2)!.body).toBe("Your menu closed after 10 minutes with no reply. Nothing was changed.");
    expect(sent.at(-1)!.body.startsWith("Your language:")).toBe(true);
    expect((await prompt())!.kind).toBe("menu_language");
  });

  it("has reset for a reply that is no keyword too (only the notice), and 0 then asks to confirm the deletion", async () => {
    await subscriber("en");
    await send("2");
    await idle(10);
    expect(await send("thanks")).toMatchObject({ keyword: "other", action: "none", replied: true });
    expect((await lastReply()).body).toBe("Your menu closed after 10 minutes with no reply. Nothing was changed.");
    expect(await prompt()).toBeNull();

    await send("2");
    await idle(12);
    expect(await send("0")).toMatchObject({ action: "ask_delete", replied: true });
    expect((await prompt())!.kind).toBe("delete_confirm");
  });

  it("is still open just before 10 minutes, and after its hour is gone without a word (the purge deletes the row)", async () => {
    await subscriber("en");
    await send("1");
    await idle(9);
    expect(await send("1")).toMatchObject({ action: "menu_reply" });
    await idle(61);
    const before = (await replies()).length;
    expect(await send("1")).toMatchObject({ action: "menu", replied: true });
    const sent = await replies();
    expect(sent.length).toBe(before + 1);
    expect(sent.at(-1)!.body.startsWith("Your street:")).toBe(true);
    await idle(61);
    const [job] = await owner`select command from cron.job where jobname = 'subscriptions-purge-inbound'`;
    await owner.unsafe(job!.command as string);
    expect(await prompt()).toBeNull();
  });
});

describe("the daily limit of 5 menus", () => {
  it("answers a 6th reply 1 or 2 with the limit and the Hub's number, keeping only a keyed hash of the number", async () => {
    await subscriber("en");
    for (let i = 0; i < 5; i += 1) {
      await send(i % 2 === 0 ? "1" : "2");
      await send("0"); // closes the menu at its first step
    }
    expect(await owner`select client_hash from rate_limit where scope = ${MENU_SCOPE}`).toHaveLength(5);
    expect(await send("2")).toMatchObject({ action: "menu", replied: true });
    expect((await lastReply()).body).toBe(`You have used today's 5 menus. Try again tomorrow, or call the Hub at ${HUB_NUMBER}.`);
    expect(await prompt()).toBeNull();
    expect(await send("1")).toMatchObject({ replied: true });
    expect((await lastReply()).body).toContain("5 menus");
    // Not counted again, and kept as the number's keyed hash only.
    const hashes = await owner`select client_hash from rate_limit where scope = ${MENU_SCOPE}`;
    expect(hashes).toHaveLength(5);
    expect(hashes.every((h) => h.client_hash === clientHash(KEY, MENU_SCOPE, NUMBER))).toBe(true);
    expect(JSON.stringify(hashes)).not.toContain("5550161");
    // Reply 3 is no menu: still answered.
    await send("3");
    expect((await lastReply()).body).toBe("You have no check-in request.");
  });

  it("counts menus started today in Toronto: yesterday's do not count", async () => {
    await subscriber("en");
    const hash = clientHash(KEY, MENU_SCOPE, NUMBER);
    await owner`insert into rate_limit (scope, client_hash, at) select ${MENU_SCOPE}, ${hash}, (date_trunc('day', now() at time zone 'America/Toronto') at time zone 'America/Toronto') - interval '1 minute' from generate_series(1, 5)`;
    await send("1");
    expect((await lastReply()).body.startsWith("Your street:")).toBe(true);
  });

  it("offers the edit link once S07.06 wires it: 'Reply 1 for a link', and a 1 within 10 minutes asks the port for it", async () => {
    await subscriber("en");
    const asked: string[] = [];
    const editLink: EditLinkPort = { available: true, send: async (_tx, s) => void asked.push(`${s.id}:${s.lang}`) };
    await owner`insert into rate_limit (scope, client_hash, at) select ${MENU_SCOPE}, ${clientHash(KEY, MENU_SCOPE, NUMBER)}, now() from generate_series(1, 5)`;
    await send("2", { editLink });
    expect((await lastReply()).body).toBe(`You have used today's 5 menus. Reply 1 for a link to make changes online, or call the Hub at ${HUB_NUMBER}.`);
    expect((await prompt())!.kind).toBe("edit_link_offer");
    expect(await send("1", { editLink })).toMatchObject({ action: "edit_link", replied: true });
    expect(asked).toHaveLength(1);
    expect(await prompt()).toBeNull();
    // Any other reply cancels the offer.
    await send("2", { editLink });
    await send("thanks", { editLink });
    expect(await prompt()).toBeNull();
    expect(asked).toHaveLength(1);
  });
});

describe("reply 3: withdraw a check-in request", () => {
  it("asks checkins' withdrawRequest port: 'You have no check-in request' until E08, the withdrawal's confirmation when there was one", async () => {
    const id = await subscriber("en");
    expect(await send("3")).toMatchObject({ action: "menu", replied: true });
    expect(await lastReply()).toMatchObject({ purpose: "menu_reply", body: "You have no check-in request." });
    const asked: string[] = [];
    const checkins: CheckinRequests = { withdrawRequest: async (subscriberId) => (asked.push(subscriberId), "withdrawn"), locationChanging: async () => "none" };
    await send("3", { checkins });
    expect(asked).toEqual([id]);
    expect((await lastReply()).body).toBe("Your check-in request is withdrawn.");
    // Not a menu: nothing is counted toward the daily limit and no prompt is open.
    expect(await owner`select 1 from rate_limit where scope = ${MENU_SCOPE}`).toHaveLength(0);
    expect(await prompt()).toBeNull();
  });
});

describe("a Twilio retry of a menu reply", () => {
  it("changes nothing: the page does not advance and no reply is sent", async () => {
    await subscriber("en");
    await send("1");
    const retried = text("1");
    await routerOn().handle(retried);
    const before = { replies: await replies(), prompt: await prompt() };
    expect(await routerOn().handle(retried)).toEqual({ kind: "duplicate" });
    expect(await replies()).toEqual(before.replies);
    expect(await prompt()).toEqual(before.prompt);
  });
});

describe("privacy", () => {
  it("logs the keyword, the state and the action only: no number, no body, no subscriber id", async () => {
    const id = await subscriber("en");
    for (const reply of ["1", "1", "1", "2", "2", "9", "0"]) await send(reply);
    const logged = JSON.stringify(routerLines);
    expect(logged).not.toContain("5550161");
    expect(logged).not.toContain(id);
    expect(routerLines.every((line) => Object.keys(line.fields).every((key) => ["keyword", "state", "action", "replied"].includes(key)))).toBe(true);
    // Every reply is one segment as the encoder counts the stored body.
    for (const reply of await replies()) expect(countSms(reply.body).segments, reply.body).toBe(1);
  });
});
