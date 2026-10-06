import { describe, expect, it } from "vitest";
import { SAFETY_OVERRIDE_TYPES } from "./audience";
import {
  EditChangeRequestSchema,
  EditDoneBodySchema,
  EditExpiredBodySchema,
  EditViewBodySchema,
  MUTABLE_TOPICS,
  SUBSCRIPTION_EDIT_ERROR_CODES,
  SubscriptionEditErrorSchema,
  TOPIC_IDS,
  checkEditChangeRequest,
  checkEditTokenRequest,
  isMutableTopic,
  isSubscriptionPath,
  subscriptionEditErrorBody,
  subscriptionPagePath,
} from "./subscriptionEdit";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";
const F1 = "0190f000-0000-7000-8000-000000000001";
const body = (over: Record<string, unknown> = {}) => ({ v: 1, token: TOKEN, lang: "ur", neighbourhood: "TP", places: [], groups: [], muted_topics: [], ...over });

describe("the edit link's wire contract (S07.06)", () => {
  it("reads a token of 43 base64url characters and nothing else", () => {
    expect(checkEditTokenRequest({ v: 1, token: TOKEN })).toEqual({ ok: true, value: TOKEN });
    for (const raw of [{ v: 1, token: TOKEN.slice(1) }, { v: 1, token: `${TOKEN}A` }, { v: 1, token: TOKEN.replace("A", "+") }, { v: 2, token: TOKEN }, { v: 1, token: TOKEN, phone: "x" }, null, "x"]) {
      expect(checkEditTokenRequest(raw)).toEqual({ ok: false, code: "invalid_request" });
    }
  });

  it("reads a change: places merged by building and sorted, groups and topics in their lists' order, no neighbourhood refused with its reason", () => {
    const checked = checkEditChangeRequest(
      body({
        places: [
          { rsn: "9", floors: [] },
          { rsn: "10", floors: [F1.toUpperCase()] },
          { rsn: "9", floors: [F1] },
        ],
        groups: ["families", "seniors"],
        muted_topics: ["winter", "power"],
      }),
    );
    expect(checked).toEqual({
      ok: true,
      value: {
        token: TOKEN,
        lang: "ur",
        neighbourhood: "TP",
        places: [
          { rsn: "10", floors: [F1] },
          { rsn: "9", floors: [F1] },
        ],
        groups: ["seniors", "families"],
        mutedTopics: ["power", "winter"],
      },
    });
    expect(checkEditChangeRequest(body({ neighbourhood: null }))).toEqual({ ok: false, code: "neighbourhood_missing" });
  });

  it("refuses what the page can never send: fire muted, the check-in group, zh-Hant, a phone number, an extra field", () => {
    for (const over of [{ muted_topics: ["fire"] }, { groups: ["checkin"] }, { lang: "zh-Hant" }, { phone: "+14165550123" }, { places: [{ rsn: "x", floors: [] }] }]) {
      expect(checkEditChangeRequest(body(over)), JSON.stringify(over)).toEqual({ ok: false, code: "invalid_request" });
    }
    expect(EditChangeRequestSchema.safeParse(body()).success).toBe(true);
  });

  it("lets every topic be muted but fire and evacuation, which nobody can mute (AD-7)", () => {
    expect([...MUTABLE_TOPICS]).toEqual(TOPIC_IDS.filter((topic) => !SAFETY_OVERRIDE_TYPES.includes(topic)));
    expect(isMutableTopic("fire")).toBe(false);
    expect(isMutableTopic("water")).toBe(true);
    expect(isMutableTopic("tsunami")).toBe(false);
  });

  it("answers with bodies that say what happened, the expired one a success body, and failures as {error: {code, message_key}}", () => {
    expect(EditExpiredBodySchema.parse({ v: 1, status: "expired" })).toBeDefined();
    expect(EditDoneBodySchema.parse({ v: 1, status: "changed" })).toBeDefined();
    expect(EditDoneBodySchema.parse({ v: 1, status: "deleted" })).toBeDefined();
    const view = { v: 1, status: "ok", subscription: { lang: "en", neighbourhood: "TP", places: [{ rsn: "1", floors: [F1] }], groups: ["seniors"], muted_topics: [], phone_last2: "23" } };
    expect(EditViewBodySchema.parse(view)).toEqual(view);
    // Never more of the number than its last two digits.
    expect(EditViewBodySchema.safeParse({ ...view, subscription: { ...view.subscription, phone_last2: "0123" } }).success).toBe(false);
    for (const code of SUBSCRIPTION_EDIT_ERROR_CODES) expect(SubscriptionEditErrorSchema.parse(subscriptionEditErrorBody(code))).toEqual({ error: { code, message_key: `subscriptionEdit.error.${code}` } });
  });

  it("knows the page and its API in any language, and nothing else", () => {
    expect(subscriptionPagePath("ps", TOKEN)).toBe(`/ps/subscription/${TOKEN}`);
    for (const path of [subscriptionPagePath("en", TOKEN), "/prs/subscription", "/api/subscription", "/api/subscription/view"]) expect(isSubscriptionPath(path), path).toBe(true);
    for (const path of ["/", "/en", "/en/subscriptions", "/api/subscriptions", "/staff/subscription", "/en/text-alerts/subscription"]) expect(isSubscriptionPath(path), path).toBe(false);
  });
});
