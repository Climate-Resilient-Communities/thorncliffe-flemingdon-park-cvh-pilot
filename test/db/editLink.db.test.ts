// The one-time web link against a real database (S07.06), as src/app/subscriptionEdit.ts and src/app/inbound.ts compose it: asked for from the
// menus' offers (the daily limit's, and a menu closed with nothing changed), made as a hashed token valid 30 minutes and texted as
// `/{lang}/subscription/{token}`; the page's view (reads only), its change (the link used in the same transaction, a confirmation queued) and
// its deletion (E07's one deletion, nothing sent); a refused change uses nothing; an unknown, used or run-out link is `expired`; a link
// preview's GET of the page (the page module as the server renders it) and two submissions of one link at once through the change route make
// exactly one change; the change's locks (checkins asked before the subscriber's row is locked, then an edit's lock, under which a resend
// still finds the resident receiving); the grants and the guard. Every number is fictional (555-01xx) and nothing reaches Twilio.
import { randomBytes } from "node:crypto";
import { createTranslator, type AbstractIntlMessages } from "next-intl";
import postgres from "postgres";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import SubscriptionEditPage from "../../src/app/[lang]/subscription/[token]/page";
import { subscriptionChangeResponse, subscriptionViewResponse, type SubscriptionRouteDeps } from "../../src/app/api/subscription/handler";
import { EDIT_LINK_TTL_MS, type EditChange } from "../../src/contracts/subscriptionEdit";
import en from "../../src/i18n/messages/en.json";
import { createDeliveryQueue } from "../../src/modules/messaging";
import { floorsOfBuilding, listBuildings, neighbourhoodIds } from "../../src/modules/places";
import {
  MENU_SCOPE,
  createEditLink,
  createInboundRouter,
  createMenus,
  editTokenHash,
  noCheckinRequestsYet,
  type CheckinCleanup,
  type CheckinRequestChanges,
  type CheckinRequests,
  type EditLink,
  type InboundOutcome,
  type MenuPlaces,
  subscriberReceives,
} from "../../src/modules/subscriptions";
import { subscriberStore, type SubscriberStore } from "../../src/modules/subscriptions/adapters/subscriberStore";
import { createDb, type Db } from "../../src/platform/db";
import { BASE_URL, dispatcherWorld, type DispatcherWorld } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

// The page's server render outside Next: next-intl's request-scoped readers give the English catalog, and the address's params are the
// link's, as Next gives them to the page's client part.
const address = vi.hoisted(() => ({ params: {} as Record<string, string> }));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => undefined,
  getMessages: async () => en,
  getTranslations: async ({ locale, namespace }: { locale: string; namespace?: string }) => createTranslator({ locale, messages: en as unknown as AbstractIntlMessages, namespace } as never),
}));
vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), useParams: () => address.params }));

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let world: DispatcherWorld;

const VERSION = "2026-10-02.1";
const KEY = "a-test-key-for-the-edit-link";
const NUMBER = "+14165550171";
// Link Street has two buildings (21 with floors 1 and 2; 23 with none) and Far Road one, in the other neighbourhood.
const RSN_21 = "9106001";
const RSN_23 = "9106002";
const RSN_FAR = "9106003";
const RSNS = [RSN_21, RSN_23, RSN_FAR];
const FLOOR_1 = "0190f000-0000-7000-8000-000000610001";
const FLOOR_2 = "0190f000-0000-7000-8000-000000610002";
const FLOOR_FAR = "0190f000-0000-7000-8000-000000610003";
const UNKNOWN_FLOOR = "0190f000-0000-7000-8000-000000619999";

let sid = 0;
const nextSid = () => `SM${(++sid + 0x6060).toString(16).padStart(32, "0")}`;
/** The tokens the edit link made, in order (its token seam), and what checkins' ports were asked. */
const made: string[] = [];
const located: { subscriberId: string; places: unknown }[] = [];
const cleaned: string[] = [];
let withdrawal: "withdrawn" | "none" = "none";

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  appSql = postgres(url.href, { max: 6, onnotice: () => {} });
  app = createDb(url.href);
  world = dispatcherWorld(owner, appSql, app);
  await owner`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H'), ('FP', 'Flemingdon Park', 'M3C') on conflict do nothing`;
  await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values
                (${RSN_21}, 'TP', '21 Link Street', 43.7, -79.34, now()), (${RSN_23}, 'TP', '23 Link Street', 43.7, -79.34, now()),
                (${RSN_FAR}, 'FP', '5 Far Road', 43.72, -79.33, now()) on conflict do nothing`;
  await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${FLOOR_1}, ${RSN_21}, '1', 1, true),
                (${FLOOR_2}, ${RSN_21}, '2', 2, true), (${FLOOR_FAR}, ${RSN_FAR}, '1', 1, false) on conflict do nothing`;
});

async function resetAll() {
  await owner`delete from subscriber`;
  await owner`delete from pending_signup`;
  await owner`delete from inbound_reply`;
  await owner`delete from inbound_seen`;
  await owner`delete from inbound_keyword_count`;
  await owner`delete from rate_limit where scope in ('inbound', 'inbound_mute', ${MENU_SCOPE})`;
  await owner`delete from inbound_limited_count`;
  await world.reset();
  made.length = 0;
  located.length = 0;
  cleaned.length = 0;
  withdrawal = "none";
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

/** checkins' ports as fakes that record what they were asked (E08 implements them). */
const checkins: CheckinRequests & CheckinRequestChanges & CheckinCleanup = {
  ...noCheckinRequestsYet,
  withdrawRequest: async () => "none",
  locationChanging: async (subscriberId, places) => {
    located.push({ subscriberId, places });
    return withdrawal;
  },
  deleteForSubscriber: async (subscriberId) => void cleaned.push(subscriberId),
};

/**
 * The edit link as src/app/subscriptionEdit.ts composes it, with places' real readers and a token seam that records each token; checkins'
 * ports and the subscriber store can be swapped, and `onText` is called with each text's body before it is queued, inside the transaction
 * that queues it (what other sessions see then).
 */
function editLinkOn(seams: { checkins?: CheckinRequests & CheckinRequestChanges & CheckinCleanup; subscribers?: SubscriberStore; onText?: (body: string) => Promise<void> } = {}): EditLink {
  const queue = createDeliveryQueue();
  return createEditLink({
    db: app,
    enqueue: async (tx, input) => {
      await seams.onText?.(input.body);
      return queue.enqueueTransactional(tx, input);
    },
    skipRecipientDeliveries: (tx, recipient) => queue.skipRecipientDeliveries(tx, recipient),
    places: {
      neighbourhoodIds: (executor) => neighbourhoodIds(executor),
      floorIdsOf: async (tx, rsn, options) => (await floorsOfBuilding(tx, rsn, options))?.map((floor) => floor.id) ?? null,
    },
    checkins: seams.checkins ?? checkins,
    ...(seams.subscribers ? { stores: { subscribers: seams.subscribers } } : {}),
    publicBaseUrl: () => `${BASE_URL}/`,
    pricePerSegmentCents: () => 1.5,
    newToken: () => {
      const token = randomBytes(32).toString("base64url");
      made.push(token);
      return token;
    },
  });
}

/** GET /{lang}/subscription/{token}: the page module's HTML, as the server renders it for a link preview. */
async function pageGet(lang: string, token: string): Promise<string> {
  address.params = { lang, token };
  return renderToStaticMarkup((await SubscriptionEditPage({ params: Promise.resolve({ lang, token }) } as never)) as ReactElement);
}

/** A POST to one of the page's routes, answered by its handler as the route file composes it, with this file's edit link. */
function postTo(handler: (deps: SubscriptionRouteDeps, request: Request) => Promise<Response>, body: unknown): Promise<Response> {
  const request = new Request(`${BASE_URL}/api/subscription/x`, { method: "POST", body: JSON.stringify(body) });
  return handler({ edit: editLinkOn, log: { info: () => {}, error: () => {} } }, request);
}

/** places' real readers for the menus, the list kept to this file's buildings. */
const menuPlaces: MenuPlaces = {
  buildings: async (tx) => (await listBuildings(tx)).filter((building) => RSNS.includes(building.rsn)),
  floorsOf: (tx, rsn, options) => floorsOfBuilding(tx, rsn, options),
};

/** A text from the number, through the router as src/app/inbound.ts composes it: the menus send the link through the edit link's port. */
function send(body: string): Promise<InboundOutcome> {
  const queue = createDeliveryQueue();
  return createInboundRouter({
    db: app,
    places: { floorIdsOf: async (executor, rsn) => (await floorsOfBuilding(executor, rsn))?.map((f) => f.id) ?? null },
    enqueue: (tx, input, now) => createDeliveryQueue(now ? { now: () => now } : {}).enqueueTransactional(tx, input),
    skipRecipientDeliveries: (tx, recipient) => queue.skipRecipientDeliveries(tx, recipient),
    checkins,
    menus: createMenus({ enqueue: (tx, input) => queue.enqueueTransactional(tx, input), pricePerSegmentCents: () => 1.5, places: menuPlaces, checkins, editLink: editLinkOn().port }),
    numberKey: () => KEY,
    publicBaseUrl: () => BASE_URL,
    pricePerSegmentCents: () => 1.5,
  }).handle({ messageSid: nextSid(), from: NUMBER, body, optOutType: null });
}

/** A subscriber made directly (S07.04's YES is tested there), with its places, groups and muted topics. */
async function subscriber(options: { lang?: string; groups?: string[]; places?: { rsn: string; floorId: string | null }[]; muted?: string[] } = {}): Promise<string> {
  const id = crypto.randomUUID();
  await owner`insert into subscriber (id, phone, lang, neighbourhood_id, groups, consent_version, started_by)
              values (${id}, ${NUMBER}, ${options.lang ?? "en"}, 'TP', ${options.groups ?? ["seniors"]}, ${VERSION}, 'web')`;
  for (const place of options.places ?? [{ rsn: RSN_21, floorId: FLOOR_1 }]) await owner`insert into subscriber_place (id, subscriber_id, rsn, floor_id) values (${crypto.randomUUID()}, ${id}, ${place.rsn}, ${place.floorId})`;
  for (const topic of options.muted ?? []) await owner`insert into subscriber_topic_optout (subscriber_id, topic) values (${id}, ${topic})`;
  return id;
}

/** A link made as the menus make it (the port, in a transaction of the app's own), and its token. */
async function linkFor(id: string, lang = "en"): Promise<string> {
  await app.transaction((tx) => editLinkOn().port.send(tx, { id, lang: lang as "en" }));
  return made.at(-1)!;
}

const texts = async () =>
  (await owner`select purpose, lang, body, send_by, recipient_id, state from delivery where recipient_kind = 'subscriber' order by created_at, id`) as unknown as {
    purpose: string;
    lang: string;
    body: string;
    send_by: Date;
    recipient_id: string | null;
    state: string;
  }[];
const tokenRows = async () => (await owner`select id, subscriber_id, token_hash, created_at, expires_at, used_at from subscription_edit_token order by created_at`) as unknown as { id: string; subscriber_id: string; token_hash: string; created_at: Date; expires_at: Date; used_at: Date | null }[];
const subscriberRow = async (id: string) => (await owner`select lang, neighbourhood_id, groups from subscriber where id = ${id}`)[0] ?? null;
const placesOf = async (id: string) => (await owner`select rsn, floor_id from subscriber_place where subscriber_id = ${id} order by rsn, floor_id nulls first`).map((row) => ({ rsn: row.rsn as string, floorId: row.floor_id as string | null }));
const mutedOf = async (id: string) => (await owner`select topic from subscriber_topic_optout where subscriber_id = ${id} order by topic`).map((row) => row.topic as string);
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
/** Moves every link's 30 minutes back, as if it had been made `minutes` ago. */
const age = (minutes: number) =>
  owner`alter table subscription_edit_token disable trigger subscription_edit_token_guard`
    .then(() => owner`update subscription_edit_token set created_at = created_at - ${minutes} * interval '1 minute', expires_at = expires_at - ${minutes} * interval '1 minute'`)
    .then(() => owner`alter table subscription_edit_token enable trigger subscription_edit_token_guard`);

const change = (token: string, over: Partial<EditChange> = {}): EditChange => ({
  token,
  lang: "fr",
  neighbourhood: "TP",
  places: [
    { rsn: RSN_21, floors: [FLOOR_2] },
    { rsn: RSN_23, floors: [] },
  ],
  groups: ["newcomers"],
  mutedTopics: ["water", "winter"],
  ...over,
});

describe("the table and its grants", () => {
  it("are the app's alone: select, insert and delete, update of used_at only; and the app may now change a subscriber's groups", async () => {
    const [rights] = await owner`select has_table_privilege('cvh_app', 'subscription_edit_token', 'select') as sel,
                                        has_table_privilege('cvh_app', 'subscription_edit_token', 'insert') as ins,
                                        has_table_privilege('cvh_app', 'subscription_edit_token', 'delete') as del,
                                        has_column_privilege('cvh_app', 'subscription_edit_token', 'used_at', 'update') as used,
                                        has_column_privilege('cvh_app', 'subscription_edit_token', 'token_hash', 'update') as hash,
                                        has_column_privilege('cvh_app', 'subscription_edit_token', 'expires_at', 'update') as expires,
                                        has_table_privilege('anon', 'subscription_edit_token', 'select') as anon,
                                        has_table_privilege('authenticated', 'subscription_edit_token', 'select') as authenticated,
                                        has_column_privilege('cvh_app', 'subscriber', 'groups', 'update') as groups,
                                        has_column_privilege('cvh_app', 'subscriber', 'phone', 'update') as phone,
                                        has_column_privilege('cvh_app', 'subscriber', 'consent_version', 'update') as consent`;
    // consent_version: S09.07's re-consent sets it to the campaign's terms version (20261006155000_reconsent_campaign.sql), never the page.
    expect(rights).toEqual({ sel: true, ins: true, del: true, used: true, hash: false, expires: false, anon: false, authenticated: false, groups: true, phone: false, consent: true });
    const [rls] = await owner`select relrowsecurity from pg_class where relname = 'subscription_edit_token'`;
    expect(rls!.relrowsecurity).toBe(true);
  });

  it("keeps a link used once: used_at is set from null and never again, nothing else changes, and a link lasts exactly 30 minutes", async () => {
    const id = await subscriber();
    await linkFor(id);
    const [row] = await tokenRows();
    expect(row!.expires_at.getTime() - row!.created_at.getTime()).toBe(EDIT_LINK_TTL_MS);
    await expect(appSql`update subscription_edit_token set used_at = null where id = ${row!.id}`).rejects.toThrow(/used once/);
    await appSql`update subscription_edit_token set used_at = now() where id = ${row!.id}`;
    await expect(appSql`update subscription_edit_token set used_at = now() where id = ${row!.id}`).rejects.toThrow(/used once/);
    await expect(owner`update subscription_edit_token set expires_at = expires_at + interval '1 hour' where id = ${row!.id}`).rejects.toThrow(/only used_at/);
    await expect(owner`insert into subscription_edit_token (id, subscriber_id, token_hash, created_at, expires_at) values (${crypto.randomUUID()}, ${id}, ${"b".repeat(64)}, now(), now() + interval '2 hours')`).rejects.toThrow();
  });

  it("are purged once run out by their own pg_cron job", async () => {
    const [job] = await owner`select schedule, command from cron.job where jobname = 'subscriptions-purge-edit-tokens'`;
    expect(job!.schedule).toBe("*/15 * * * *");
    const id = await subscriber();
    await linkFor(id);
    await age(31);
    await owner.unsafe(job!.command as string);
    expect(await tokenRows()).toEqual([]);
  });
});

describe("asking for the link by text", () => {
  it("at the daily menu limit: 'Reply 1 for a link', and the 1 makes a hashed token valid 30 minutes and texts /{lang}/subscription/{token}", async () => {
    const id = await subscriber({ lang: "ur" });
    for (let n = 0; n < 5; n += 1) {
      await send("2");
      await send("0");
    }
    await send("2");
    expect((await texts()).at(-1)!.body).toContain("ویب لنک");
    expect(await send("1")).toMatchObject({ action: "edit_link", replied: true });

    const [row] = await tokenRows();
    const token = made.at(-1)!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row).toMatchObject({ subscriber_id: id, token_hash: editTokenHash(token), used_at: null });
    const link = (await texts()).at(-1)!;
    expect(link).toMatchObject({ purpose: "edit_link", lang: "ur", recipient_id: id, state: "queued" });
    expect(link.body).toContain(`${BASE_URL}/ur/subscription/${token} `);
    // The text is due by the moment its link runs out: one still queued then is skipped at the hand-off, never sent late.
    expect(link.send_by.getTime()).toBe(row!.expires_at.getTime());
    // The token is stored in its own text's body only (the outbox keeps every body as queued, and there it works for the link's 30 minutes
    // and once): the link's row holds its sha256, and no other row of the outbox, no audit record and no ops event names it.
    expect(JSON.stringify(await tokenRows())).not.toContain(token);
    expect(await owner`select purpose from delivery d where strpos(row_to_json(d)::text, ${token}) > 0`).toEqual([{ purpose: "edit_link" }]);
    expect(await owner`select 1 from audit_event a where strpos(row_to_json(a)::text, ${token}) > 0`).toHaveLength(0);
    expect(await owner`select 1 from ops_event o where strpos(row_to_json(o)::text, ${token}) > 0`).toHaveLength(0);
  });

  it("from any menu closed with nothing changed: '... Reply 1 for a link', with the offer open 10 minutes; any other reply cancels it", async () => {
    await subscriber();
    await send("1");
    expect(await send("0")).toMatchObject({ action: "menu_reply", replied: true });
    expect((await texts()).at(-1)!.body).toBe("Menu closed. Nothing was changed. Reply 1 for a link to make changes online.");
    expect((await owner`select kind from sms_prompt`)[0]!.kind).toBe("edit_link_offer");
    expect(await send("1")).toMatchObject({ action: "edit_link", replied: true });
    expect(await tokenRows()).toHaveLength(1);
    expect(await owner`select 1 from sms_prompt`).toHaveLength(0);

    // Closed again; this time the resident sends 2: the offer is cancelled and the language menu starts.
    await send("1");
    await send("0");
    expect(await send("2")).toMatchObject({ action: "menu", replied: true });
    expect((await owner`select kind from sms_prompt`)[0]!.kind).toBe("menu_language");
  });

  it("replaces the subscriber's earlier link: only the newest works", async () => {
    const id = await subscriber();
    const first = await linkFor(id);
    const second = await linkFor(id);
    expect(await tokenRows()).toHaveLength(1);
    const editLink = editLinkOn();
    expect(await editLink.view(first)).toEqual({ v: 1, status: "expired" });
    expect(await editLink.view(second)).toMatchObject({ v: 1, status: "ok" });
  });
});

describe("the page's view", () => {
  it("shows the choices as the page edits them, the number by its last two digits only, and uses nothing", async () => {
    const id = await subscriber({ groups: ["seniors", "checkin"], places: [{ rsn: RSN_21, floorId: FLOOR_2 }, { rsn: RSN_21, floorId: FLOOR_1 }, { rsn: RSN_FAR, floorId: null }], muted: ["power"] });
    const token = await linkFor(id);
    const view = await editLinkOn().view(token);
    expect(view).toEqual({
      v: 1,
      status: "ok",
      subscription: {
        lang: "en",
        neighbourhood: "TP",
        places: [
          { rsn: RSN_21, floors: [FLOOR_1, FLOOR_2].sort() },
          { rsn: RSN_FAR, floors: [] },
        ],
        groups: ["seniors"],
        muted_topics: ["power"],
        phone_last2: "71",
        checkin: null,
      },
    });
    expect(JSON.stringify(view)).not.toContain("5550171");
    // Opened again: still usable.
    expect(await editLinkOn().view(token)).toMatchObject({ status: "ok" });
    expect((await tokenRows())[0]!.used_at).toBeNull();
  });

  it("is not turned to expired, and does not wait, while another transaction holds the subscriber's row (a menu's save, another tab)", async () => {
    const id = await subscriber();
    const token = await linkFor(id);
    for (const strength of ["no key update", "update"]) {
      const view = await owner.begin(async (sql) => {
        await sql.unsafe(`select id from subscriber where id = $1 for ${strength}`, [id]);
        return editLinkOn().view(token);
      });
      expect(view, strength).toMatchObject({ v: 1, status: "ok", subscription: { lang: "en", phone_last2: "71" } });
    }
  });

  it("answers expired for a token never made, a used link and one past its 30 minutes", async () => {
    const id = await subscriber();
    const editLink = editLinkOn();
    expect(await editLink.view(randomBytes(32).toString("base64url"))).toEqual({ v: 1, status: "expired" });
    const token = await linkFor(id);
    await age(31);
    expect(await editLink.view(token)).toEqual({ v: 1, status: "expired" });
    const fresh = await linkFor(id);
    expect(await editLink.change(change(fresh))).toEqual({ kind: "changed" });
    expect(await editLink.view(fresh)).toEqual({ v: 1, status: "expired" });
  });
});

describe("a change", () => {
  it("writes every choice and uses the link in the same transaction, keeps the check-in group, and confirms in the new language", async () => {
    const id = await subscriber({ groups: ["seniors", "checkin"], muted: ["power"] });
    const token = await linkFor(id);
    expect(await editLinkOn().change(change(token))).toEqual({ kind: "changed" });

    expect(await subscriberRow(id)).toEqual({ lang: "fr", neighbourhood_id: "TP", groups: ["newcomers", "checkin"] });
    expect(await placesOf(id)).toEqual([
      { rsn: RSN_21, floorId: FLOOR_2 },
      { rsn: RSN_23, floorId: null },
    ]);
    expect(await mutedOf(id)).toEqual(["water", "winter"]);
    expect((await tokenRows())[0]!.used_at).not.toBeNull();
    const confirmation = (await texts()).at(-1)!;
    expect(confirmation).toMatchObject({ purpose: "edit_link", lang: "fr", recipient_id: id, state: "queued" });
    expect(confirmation.body).toContain("(416) 421-8997");
    // checkins was told before the places changed, with the places left on the page.
    expect(located).toEqual([{ subscriberId: id, places: [{ rsn: RSN_21, floorId: FLOOR_2 }, { rsn: RSN_23, floorId: null }] }]);
  });

  it("asks checkins nothing when the places stay as they were, and adds the request's withdrawal to the confirmation when checkins reports one", async () => {
    const id = await subscriber();
    const token = await linkFor(id);
    await editLinkOn().change(change(token, { places: [{ rsn: RSN_21, floors: [FLOOR_1] }], lang: "en" }));
    expect(located).toEqual([]);

    withdrawal = "withdrawn";
    const next = await linkFor(id);
    await editLinkOn().change(change(next, { lang: "en", places: [{ rsn: RSN_FAR, floors: [FLOOR_FAR] }], neighbourhood: "FP" }));
    expect(located).toHaveLength(1);
    expect((await texts()).at(-1)!.body).toBe("Your check-in request is withdrawn.");
    expect(await subscriberRow(id)).toMatchObject({ neighbourhood_id: "FP" });
  });

  it("asks checkins before it locks the subscriber's row (E08's lock order), then saves under an edit's lock: a resend still finds the resident receiving", async () => {
    const id = await subscriber();
    const token = await linkFor(id);
    const seen: { at: string; row: string; placesThen?: string[]; receives?: boolean }[] = [];
    const editLink = editLinkOn({
      checkins: {
        ...checkins,
        // E08's request lock order puts the round threads' `alert` rows before the subscriber row: the change has not locked it yet, and
        // the old places are still there to read.
        locationChanging: async (subscriberId, _places, tx) => {
          const placesThen = [...(await tx.execute(`select rsn from subscriber_place where subscriber_id = '${subscriberId}'`))].map((r) => (r as { rsn: string }).rsn);
          seen.push({ at: "checkins", row: await rowLock(subscriberId), placesThen });
          return "none";
        },
      },
      // The confirmation is queued after every write, in the change's transaction: another session then finds the row held for an edit
      // (an approval's FOR SHARE capture would wait for it) and the resident still receiving (the resend's check, FOR KEY SHARE SKIP LOCKED).
      onText: async () => {
        const receives = await app.transaction((other) => subscriberReceives(other, id));
        seen.push({ at: "confirmation", row: await rowLock(id), receives });
      },
    });
    expect(await editLink.change(change(token))).toEqual({ kind: "changed" });
    expect(seen).toEqual([
      { at: "checkins", row: "free", placesThen: [RSN_21] },
      { at: "confirmation", row: "edit", receives: true },
    ]);
    // Nothing holds the row once the change's transaction is over.
    expect(await rowLock(id)).toBe("free");
  });

  it("undoes all of it, the link's use and what checkins did, when the resident no longer receives once the row is locked", async () => {
    const id = await subscriber();
    const token = await linkFor(id);
    // E09's re-check under the edit's lock answers no (the re-consent campaign's deadline passing while the change waited, S09.07: the store
    // answers it here; test/db/campaign.db.test.ts has a lapsed subscriber's link). What checkins writes in the change's transaction stands for
    // E08's withdrawal.
    const editLink = editLinkOn({
      checkins: {
        ...checkins,
        locationChanging: async (subscriberId, _places, tx) => {
          await subscriberStore.openNewPrompt(tx, subscriberId, "checkins_wrote_this", 60_000);
          return "withdrawn";
        },
      },
      subscribers: { ...subscriberStore, receivesShared: async () => false },
    });
    expect(await editLink.change(change(token))).toEqual({ kind: "expired" });
    expect(await subscriberRow(id)).toEqual({ lang: "en", neighbourhood_id: "TP", groups: ["seniors"] });
    expect(await placesOf(id)).toEqual([{ rsn: RSN_21, floorId: FLOOR_1 }]);
    expect(await owner`select 1 from sms_prompt`).toHaveLength(0);
    expect((await tokenRows())[0]!.used_at).toBeNull();
    expect((await texts()).filter((text) => !text.body.includes("/subscription/"))).toEqual([]);
  });

  it("refused (a building or floor that is not on the list, a neighbourhood that is not the pilot's) changes and uses nothing", async () => {
    const id = await subscriber();
    const token = await linkFor(id);
    const editLink = editLinkOn();
    expect(await editLink.change(change(token, { places: [{ rsn: "9106999", floors: [] }] }))).toEqual({ kind: "refused", code: "place_unknown" });
    expect(await editLink.change(change(token, { places: [{ rsn: RSN_21, floors: [UNKNOWN_FLOOR] }] }))).toEqual({ kind: "refused", code: "place_unknown" });
    expect(await editLink.change(change(token, { places: [{ rsn: RSN_23, floors: [FLOOR_1] }] }))).toEqual({ kind: "refused", code: "place_unknown" });
    expect(await editLink.change(change(token, { neighbourhood: "XX" }))).toEqual({ kind: "refused", code: "invalid_request" });
    expect(await subscriberRow(id)).toEqual({ lang: "en", neighbourhood_id: "TP", groups: ["seniors"] });
    expect(await placesOf(id)).toEqual([{ rsn: RSN_21, floorId: FLOOR_1 }]);
    expect((await tokenRows())[0]!.used_at).toBeNull();
    expect((await texts()).filter((text) => text.body.includes("changed"))).toEqual([]);
    // Corrected, the same link works.
    expect(await editLink.change(change(token))).toEqual({ kind: "changed" });
  });

  it("with a link past its 30 minutes, or used, is expired and changes nothing", async () => {
    const id = await subscriber();
    const token = await linkFor(id);
    await age(31);
    expect(await editLinkOn().change(change(token))).toEqual({ kind: "expired" });
    expect(await subscriberRow(id)).toEqual({ lang: "en", neighbourhood_id: "TP", groups: ["seniors"] });
    const fresh = await linkFor(id);
    await editLinkOn().change(change(fresh));
    expect(await editLinkOn().change(change(fresh, { lang: "ur" }))).toEqual({ kind: "expired" });
    expect(await subscriberRow(id)).toMatchObject({ lang: "fr" });
  });
});

describe("two submissions of one link at once, after a link preview", () => {
  it("make exactly one change; the other is expired; the preview changed and used nothing", async () => {
    const id = await subscriber({ places: [{ rsn: RSN_FAR, floorId: FLOOR_FAR }] });
    const token = await linkFor(id);
    const before = { links: await tokenRows(), subscriber: await subscriberRow(id), places: await placesOf(id) };

    // A link preview GETs the page: the page module as the server renders it, with this database holding a live link. It is the generic
    // shell (still loading), with nothing about anyone in it; the token row and the subscriber are as they were.
    const html = await pageGet("en", token);
    expect(html).toContain('data-testid="subscription-loading"');
    for (const held of [token, RSN_FAR, FLOOR_FAR, "phone_last2"]) expect(html, held).not.toContain(held);
    // A preview that runs the page's script gets as far as the view, which uses nothing either.
    expect(await (await postTo(subscriptionViewResponse, { v: 1, token })).json()).toMatchObject({ v: 1, status: "ok" });
    expect(await tokenRows()).toEqual(before.links);
    expect(await subscriberRow(id)).toEqual(before.subscriber);
    expect(await placesOf(id)).toEqual(before.places);

    // Two submissions at once through POST /api/subscription/change, as its route answers them.
    const bodies = [
      { v: 1, token, lang: "ur", neighbourhood: "TP", places: [{ rsn: RSN_21, floors: [FLOOR_2] }], groups: ["families"], muted_topics: [] },
      { v: 1, token, lang: "es", neighbourhood: "TP", places: [{ rsn: RSN_23, floors: [] }], groups: ["seniors", "newcomers"], muted_topics: ["water"] },
    ];
    const responses = await Promise.all(bodies.map((body) => postTo(subscriptionChangeResponse, body)));
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const answers = (await Promise.all(responses.map((response) => response.json()))) as { v: number; status: string }[];
    expect([...answers].sort((a, b) => a.status.localeCompare(b.status))).toEqual([
      { v: 1, status: "changed" },
      { v: 1, status: "expired" },
    ]);
    const winner = answers[0]!.status === "changed" ? { lang: "ur", groups: ["families"] } : { lang: "es", groups: ["seniors", "newcomers"] };
    expect(await subscriberRow(id)).toEqual({ ...winner, neighbourhood_id: "TP" });
    expect(await placesOf(id)).toEqual(winner.lang === "ur" ? [{ rsn: RSN_21, floorId: FLOOR_2 }] : [{ rsn: RSN_23, floorId: null }]);
    expect((await tokenRows())[0]!.used_at).not.toBeNull();
    expect((await texts()).filter((text) => text.purpose === "edit_link" && text.lang === winner.lang && !text.body.includes("/subscription/"))).toHaveLength(1);
    // Both moved the resident, but only the winner asked checkins: the other found the link used before it asked anything.
    expect(located).toEqual([{ subscriberId: id, places: winner.lang === "ur" ? [{ rsn: RSN_21, floorId: FLOOR_2 }] : [{ rsn: RSN_23, floorId: null }] }]);
  });

  it("a change and a deletion at once: exactly one of them happens", async () => {
    const id = await subscriber();
    const token = await linkFor(id);
    const [changed, deleted] = await Promise.all([editLinkOn().change(change(token)), editLinkOn().delete(token)]);
    expect([changed.kind, deleted.kind].filter((kind) => kind === "expired")).toHaveLength(1);
    if (deleted.kind === "deleted") expect(await subscriberRow(id)).toBeNull();
    else expect(await subscriberRow(id)).toMatchObject({ lang: "fr" });
  });
});

describe("'Delete my subscription'", () => {
  it("runs E07's one deletion with the link used: everything held for the number is gone, waiting texts skipped, check-ins asked, nothing sent", async () => {
    const id = await subscriber({ muted: ["water"], places: [{ rsn: RSN_21, floorId: FLOOR_1 }, { rsn: RSN_FAR, floorId: null }] });
    await send("1"); // a menu page, queued, and an open prompt
    await owner`insert into inbound_reply (id, phone) values (${crypto.randomUUID()}, ${NUMBER})`;
    const token = await linkFor(id);
    const before = await texts();

    expect(await editLinkOn().delete(token)).toEqual({ kind: "deleted" });

    expect(await subscriberRow(id)).toBeNull();
    expect(await placesOf(id)).toEqual([]);
    expect(await mutedOf(id)).toEqual([]);
    expect(await owner`select 1 from sms_prompt`).toHaveLength(0);
    expect(await owner`select 1 from inbound_reply`).toHaveLength(0);
    expect(await tokenRows()).toEqual([]);
    expect(cleaned).toEqual([id]);
    // The menu page and the link's own text, both still queued, are skipped and forget the subscriber; nothing new is queued.
    const after = await owner`select state, recipient_id from delivery where recipient_kind = 'subscriber' order by created_at, id`;
    expect(after).toHaveLength(before.length);
    for (const row of after) expect(row).toEqual({ state: "skipped", recipient_id: null });
    // The link is gone with the subscriber: opened again, it has expired.
    expect(await editLinkOn().view(token)).toEqual({ v: 1, status: "expired" });
    expect(await editLinkOn().delete(token)).toEqual({ kind: "expired" });
  });

  it("is also what STOP does to a link: it goes with the subscriber (E07 'Deletion': edit links)", async () => {
    const id = await subscriber();
    const token = await linkFor(id);
    expect(await send("STOP")).toMatchObject({ action: "delete" });
    expect(await subscriberRow(id)).toBeNull();
    expect(await tokenRows()).toEqual([]);
    expect(await editLinkOn().view(token)).toEqual({ v: 1, status: "expired" });
  });

  it("with a link past its 30 minutes is expired and deletes nothing", async () => {
    const id = await subscriber();
    const token = await linkFor(id);
    await age(31);
    expect(await editLinkOn().delete(token)).toEqual({ kind: "expired" });
    expect(await subscriberRow(id)).not.toBeNull();
  });
});
