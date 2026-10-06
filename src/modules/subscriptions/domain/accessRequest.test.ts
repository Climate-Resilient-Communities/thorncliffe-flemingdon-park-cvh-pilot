import { describe, expect, it } from "vitest";
import { checkinRowWords, deletionSummary, heldRecordLines, menuStepWords, nothingHeld, openRequests, standingOf, torontoTime, wholeDays, type HeldRecord, type RequestRecord } from "./accessRequest";

const DAY = 86_400_000;
const NOW = new Date("2026-10-30T16:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const received = (id: string, at: Date, over: Partial<RequestRecord> = {}): RequestRecord => ({
  action: "access_request.received",
  at,
  subjectId: id,
  actorStaffId: "s1",
  isDrill: false,
  meta: { request: "access" },
  ...over,
});
const closed = (id: string, at: Date, outcome = "answered"): RequestRecord => ({ action: "access_request.closed", at, subjectId: id, actorStaffId: "s2", isDrill: false, meta: { outcome } });

describe("openRequests", () => {
  it("lists the requests not closed, oldest first, with whole days open and the last day to answer", () => {
    const records = [received("b", ago(3)), received("a", ago(10), { meta: { request: "deletion" } }), received("c", ago(40)), closed("c", ago(20))];
    const open = openRequests(records, NOW);

    expect(open.map((r) => r.id)).toEqual(["a", "b"]);
    expect(open[0]).toMatchObject({ request: "deletion", daysOpen: 10, flagged: false, receivedBy: "s1", rehearsal: false });
    expect(open[0]!.dueBy.getTime()).toBe(ago(10).getTime() + 30 * DAY);
  });

  it("flags a request once it has been open for more than 25 days, as the weekly review does", () => {
    const open = openRequests([received("at", ago(25)), received("past", new Date(ago(25).getTime() - 1)), received("rehearsal", ago(26), { isDrill: true })], NOW);

    expect(open.map((r) => [r.id, r.flagged, r.rehearsal])).toEqual([
      ["rehearsal", true, true],
      ["past", true, false],
      ["at", false, false],
    ]);
  });

  it("reads a request kind it does not know as unknown rather than guessing", () => {
    expect(openRequests([received("x", ago(1), { meta: {} })], NOW)[0]!.request).toBeNull();
  });
});

describe("standingOf", () => {
  it("says whether a request was never received, is open, or is closed and how", () => {
    const records = [received("open", ago(2), { isDrill: true }), received("done", ago(5)), closed("done", ago(1), "not_verified")];

    expect(standingOf(records, "nope")).toEqual({ kind: "unknown" });
    expect(standingOf(records, "open")).toEqual({ kind: "open", receivedAt: ago(2), isDrill: true });
    expect(standingOf(records, "done")).toEqual({ kind: "closed", outcome: "not_verified", closedAt: ago(1) });
  });
});

describe("wholeDays and torontoTime", () => {
  it("count whole days and read an instant in Toronto, across the end of daylight time", () => {
    expect(wholeDays(ago(2.5), NOW)).toBe(2);
    expect(wholeDays(NOW, ago(1))).toBe(0);
    expect(torontoTime(new Date("2026-10-06T13:30:00Z"))).toBe("2026-10-06 09:30");
    expect(torontoTime(new Date("2026-11-02T14:05:00Z"))).toBe("2026-11-02 09:05");
  });
});

const NOTHING: HeldRecord = { maskedNumber: "+1 ••• ••• 0123", subscriber: null, pending: null, replies: [], texts: [], hashes: [], checkins: { kind: "not_built" }, unread: [] };

describe("heldRecordLines", () => {
  it("reads out everything held for a subscriber: places, groups, muted topics, terms, retention state, prompt, texts, hashes", () => {
    const lines = heldRecordLines({
      ...NOTHING,
      subscriber: {
        since: new Date("2026-10-01T14:00:00Z"),
        lang: "ur",
        neighbourhood: "Thorncliffe Park (TP)",
        groups: ["seniors", "families"],
        consentVersion: "2026-10-02.1",
        startedBy: "staff",
        retentionState: "active",
        reconsent: null,
        places: [
          { rsn: "9100011", address: "11 Sample Road", floor: "2" },
          { rsn: "9100099", address: null, floor: null },
        ],
        mutedTopics: [],
        prompt: { kind: "delete_confirm", since: new Date("2026-10-06T13:30:00Z"), until: new Date("2026-10-06T13:40:00Z"), step: null },
        editLink: { since: new Date("2026-10-06T13:00:00Z"), expiresAt: new Date("2026-10-06T13:30:00Z"), expired: false, usedAt: new Date("2026-10-06T13:12:00Z") },
        checkinRequest: { method: "call", place: { rsn: "9100011", address: "11 Sample Road", floor: "2" }, consentVersion: "2026-10-06.1" },
      },
      texts: [
        { createdAt: new Date("2026-10-01T14:01:00Z"), kind: "alert", purpose: null, lang: "ur", state: "undelivered", segments: 3, resendN: 1, providerErrorCode: 30003 },
      ],
      hashes: [
        { scope: "inbound", count: 2, latest: new Date("2026-10-06T13:00:00Z") },
        { scope: "sms_menu", count: 1, latest: new Date("2026-10-06T13:05:00Z") },
        { scope: "some_new_scope", count: 1, latest: new Date("2026-10-06T13:06:00Z") },
      ],
    }).join("\n");

    expect(lines).toContain("What the CVH holds for +1 ••• ••• 0123:");
    expect(lines).toContain("  Signed up: 2026-10-01 10:00, with a staff member's help");
    expect(lines).toContain("  Groups: seniors, families");
    expect(lines).toContain("    11 Sample Road (register number 9100011), floor 2");
    expect(lines).toContain("    a building no longer in the register (register number 9100099), no floor");
    expect(lines).toContain("  Muted topics: none");
    expect(lines).toContain("  Terms accepted (consent version): 2026-10-02.1");
    expect(lines).toContain("  Retention state: active");
    expect(lines).toContain("  Open prompt: asked to reply 0 again to delete the subscription (delete_confirm), sent 2026-10-06 09:30, kept until 2026-10-06 09:40");
    expect(lines).toContain("  Edit link (texted to change or delete the subscription on the web): asked for 2026-10-06 09:00, valid until 2026-10-06 09:30, used 2026-10-06 09:12");
    expect(lines).toContain(
      "  Check-in request (an ambassador on the floor sees the number and the floor): by a call, where I live: 11 Sample Road (register number 9100011), floor 2; check-in consent version 2026-10-06.1",
    );
    expect(lines).toContain("Texts (1; the words are not kept here and are not read out):");
    expect(lines).toContain("  2026-10-01 10:01  alert in ur, 3 segments, undelivered, resend 1, provider error 30003");
    expect(lines).toContain(
      "Keyed hashes of the number (rate limits, each deleted after 24 hours): texts received from the number (inbound) 2, latest 2026-10-06 09:00; text menus started (sms_menu) 1, latest 2026-10-06 09:05; some_new_scope 1, latest 2026-10-06 09:06",
    );
    expect(lines).toContain("Pending sign-up: none");
    expect(lines).not.toContain("Nothing is held");
  });

  it("reads out an edit link by its dates only, an unused one that has run out as waiting for the purge, and none", () => {
    const subscriber: NonNullable<HeldRecord["subscriber"]> = {
      since: new Date("2026-10-01T14:00:00Z"),
      lang: "en",
      neighbourhood: "Flemingdon Park (FP)",
      groups: [],
      consentVersion: "2026-10-02.1",
      startedBy: "web",
      retentionState: "active",
      reconsent: null,
      places: [],
      mutedTopics: [],
      prompt: null,
      editLink: { since: new Date("2026-10-06T13:00:00Z"), expiresAt: new Date("2026-10-06T13:30:00Z"), expired: true, usedAt: null },
      checkinRequest: null,
    };

    expect(heldRecordLines({ ...NOTHING, subscriber })).toContain(
      "  Edit link (texted to change or delete the subscription on the web): asked for 2026-10-06 09:00, valid until 2026-10-06 09:30, not used; expired: the purge deletes it within 15 minutes",
    );
    expect(heldRecordLines({ ...NOTHING, subscriber: { ...subscriber, editLink: null } })).toContain("  Edit link (texted to change or delete the subscription on the web): none");
  });

  it("reads out the end of the pilot's question, a text menu with where the resident is in it, and a prompt or state it does not know by its code", () => {
    const subscriber: NonNullable<HeldRecord["subscriber"]> = {
      since: new Date("2026-10-01T14:00:00Z"),
      lang: "en",
      neighbourhood: "Flemingdon Park (FP)",
      groups: [],
      consentVersion: "2026-10-02.1",
      startedBy: "web",
      retentionState: "reconsent_pending",
      reconsent: { kind: "open", deadlineDate: "2026-12-05" },
      places: [],
      mutedTopics: [],
      prompt: { kind: "reconsent", since: new Date("2026-11-05T15:00:00Z"), until: new Date("2026-12-06T05:00:00Z"), step: null },
      editLink: null,
      checkinRequest: null,
    };

    const asked = heldRecordLines({ ...NOTHING, subscriber });
    expect(asked).toContain("Subscriber (gets text alerts):");
    expect(asked).toContain(
      "  Retention state: asked at the end of the pilot whether to stay (reconsent_pending): deleted with everything held for the number after the campaign's deadline, the end of 2026-12-05, unless they reply YES before it",
    );
    expect(asked).toContain(
      "  Open prompt: asked at the end of the pilot whether to keep getting alerts (reply YES to stay) (reconsent), sent 2026-11-05 10:00, kept until 2026-12-06 00:00",
    );
    expect(heldRecordLines({ ...NOTHING, subscriber: { ...subscriber, retentionState: "retained", reconsent: null, prompt: null } })).toContain(
      "  Retention state: replied YES at the end of the pilot and stays (retained)",
    );

    const menu = { kind: "menu_building", since: new Date("2026-10-06T13:30:00Z"), until: new Date("2026-10-06T14:30:00Z"), step: "choosing a building on Sample Road" };
    expect(heldRecordLines({ ...NOTHING, subscriber: { ...subscriber, retentionState: "active", reconsent: null, prompt: menu } })).toContain(
      "  Open prompt: the building menu (reply 1) (menu_building), sent 2026-10-06 09:30, kept until 2026-10-06 10:30; choosing a building on Sample Road",
    );
    expect(heldRecordLines({ ...NOTHING, subscriber: { ...subscriber, retentionState: "someday", reconsent: null, prompt: { ...menu, kind: "a_new_kind", step: null } } })).toEqual(
      expect.arrayContaining(["  Retention state: someday", "  Open prompt: a_new_kind, sent 2026-10-06 09:30, kept until 2026-10-06 10:30"]),
    );
  });

  it("says what the end of the pilot means for an asked subscriber by where the campaign stands: before its deadline, past it, or cancelled", () => {
    const subscriber: NonNullable<HeldRecord["subscriber"]> = {
      since: new Date("2026-10-01T14:00:00Z"),
      lang: "en",
      neighbourhood: "Flemingdon Park (FP)",
      groups: [],
      consentVersion: "2026-10-02.1",
      startedBy: "web",
      retentionState: "reconsent_pending",
      reconsent: { kind: "lapsed", deadlineDate: "2026-12-05" },
      places: [],
      mutedTopics: [],
      prompt: { kind: "reconsent", since: new Date("2026-11-05T15:00:00Z"), until: new Date("2026-12-06T05:00:00Z"), step: null },
      editLink: null,
      checkinRequest: null,
    };

    // Past the deadline (lapsed): they get nothing, the purge deletes them, and a YES is answered "The CVH pilot has ended" and changes nothing.
    const lapsed = heldRecordLines({ ...NOTHING, subscriber });
    expect(lapsed).toContain("Subscriber (no longer gets text alerts: past the end-of-pilot deadline):");
    expect(lapsed).toContain(
      "  Retention state: asked at the end of the pilot whether to stay (reconsent_pending): the campaign's deadline, the end of 2026-12-05, has passed without a YES: they get no texts, the end-of-pilot purge deletes them with everything held for the number, and a YES no longer keeps them",
    );
    expect(lapsed).toContain(
      "  Open prompt: asked at the end of the pilot whether to keep getting alerts (its deadline has passed: a YES no longer keeps them) (reconsent), sent 2026-11-05 10:00, kept until 2026-12-06 00:00",
    );
    expect(lapsed.join("\n")).not.toMatch(/unless they reply YES|reply YES to stay/);

    // Cancelled by the owner (docs/config.md "Cancelling"): they stay reconsent_pending, keep receiving, are never lapsed nor purged.
    const cancelled = heldRecordLines({ ...NOTHING, subscriber: { ...subscriber, reconsent: { kind: "cancelled" } } });
    expect(cancelled).toContain("Subscriber (gets text alerts):");
    expect(cancelled).toContain(
      "  Retention state: asked at the end of the pilot whether to stay (reconsent_pending), by a campaign the owner cancelled: they keep getting alerts, and nothing is deleted because of it",
    );
    expect(cancelled).toContain(
      "  Open prompt: asked at the end of the pilot whether to keep getting alerts (the campaign was cancelled: a YES changes nothing) (reconsent), sent 2026-11-05 10:00, kept until 2026-12-06 00:00",
    );
    expect(cancelled.join("\n")).not.toMatch(/deleted with everything|purge deletes|reply YES to stay/);

    // With no campaign to read, nothing is said of what happens next.
    const unknown = heldRecordLines({ ...NOTHING, subscriber: { ...subscriber, reconsent: null } });
    expect(unknown).toContain("  Retention state: asked at the end of the pilot whether to stay (reconsent_pending)");
    expect(unknown).toContain("  Open prompt: asked at the end of the pilot whether to keep getting alerts (reconsent), sent 2026-11-05 10:00, kept until 2026-12-06 00:00");
  });

  it("says what the once-a-day sign-up reply's keyed hash counts: every reply to a number with no subscription, not only the sign-up link", () => {
    const lines = heldRecordLines({ ...NOTHING, hashes: [{ scope: "signup_info", count: 1, latest: new Date("2026-10-06T13:00:00Z") }] });
    expect(lines).toContain(
      "Keyed hashes of the number (rate limits, each deleted after 24 hours): replies to a number with no subscription or to a YES after the end-of-pilot deadline (the sign-up link or, while the pilot ends, that sign-ups are paused or that the pilot has ended) (signup_info) 1, latest 2026-10-06 09:00",
    );
  });

  it("says where the resident is in a text menu from the step it keeps", () => {
    const address = (rsn: string) => (rsn === "9100031" ? "31 Sample Road" : null);
    const saved = 2;
    expect(menuStepWords({ kind: "menu_building", step: { stage: "warn", saved } }, address)).toBe("asked to confirm replacing the 2 saved buildings");
    expect(menuStepWords({ kind: "menu_building", step: { stage: "street", saved, page: 0, options: ["Sample Road"] } }, address)).toBe("choosing a street");
    expect(menuStepWords({ kind: "menu_building", step: { stage: "building", saved, street: "Sample Road", streetPage: 0, page: 0, options: ["9100031"] } }, address)).toBe(
      "choosing a building on Sample Road",
    );
    const floor = { stage: "floor", saved, street: "Sample Road", streetPage: 0, rsn: "9100031", buildingPage: 0, page: 0, options: [null] } as const;
    expect(menuStepWords({ kind: "menu_building", step: { ...floor, options: [null] } }, address)).toBe("choosing a floor of 31 Sample Road (register number 9100031)");
    expect(menuStepWords({ kind: "menu_building", step: { ...floor, rsn: "9100099", options: [null] } }, address)).toBe(
      "choosing a floor of a building no longer in the register (register number 9100099)",
    );
    expect(menuStepWords({ kind: "menu_language", step: { stage: "language", page: 1, options: ["ur"] } }, address)).toBe("choosing a language");
  });

  it("reads out a pending sign-up and the replies waiting for a number with no subscription", () => {
    const lines = heldRecordLines({
      ...NOTHING,
      pending: {
        since: new Date("2026-10-05T14:00:00Z"),
        expiresAt: new Date("2026-10-07T14:00:00Z"),
        expired: true,
        lang: "en",
        neighbourhood: "Flemingdon Park (FP)",
        groups: [],
        topics: ["heat"],
        consentVersion: "2026-10-02.1",
        startedBy: "web",
        places: [{ rsn: "9100011", address: "11 Sample Road", floor: "3" }],
        checkinRequest: { method: "text", place: { rsn: "9100011", address: "11 Sample Road", floor: "3" }, consentVersion: "2026-10-06.1" },
      },
      replies: [{ since: new Date("2026-10-06T13:00:00Z"), expiresAt: new Date("2026-10-06T13:30:00Z") }],
    });

    expect(lines).toContain("Pending sign-up (waiting for YES, expired: the purge deletes it within 15 minutes):");
    expect(lines).toContain("  Started: 2026-10-05 10:00, on the web; YES accepted until 2026-10-07 10:00");
    expect(lines).toContain("    11 Sample Road (register number 9100011), floor 3");
    expect(lines).toContain(
      "  Check-in request (saved with the sign-up until YES): by a text, where I live: 11 Sample Road (register number 9100011), floor 3; check-in consent version 2026-10-06.1",
    );
    expect(lines).toContain("  Muted topics: heat");
    expect(lines).toContain("Waiting reply to a number with no subscription: 1 (each deleted when its reply goes, or after 30 minutes)");
  });

  it("reads out a check-in row that names the subscriber by its round's thread, place, method and where it stands (S08.05), and a kept one", () => {
    const at = { rsn: "9100011", address: "11 Sample Road", floor: "2" };
    const thread = "0190f000-0000-7000-8000-00000000a0a0";
    expect(checkinRowWords({ alertId: thread, method: "call", status: "pending", outcome: null }, at)).toBe(
      `in the check-in round of alert thread ${thread}, at 11 Sample Road (register number 9100011), floor 2, by a call: not checked on yet`,
    );
    expect(checkinRowWords({ alertId: thread, method: "text", status: "not_reached", outcome: "not_reached" }, at)).toBe(
      `in the check-in round of alert thread ${thread}, at 11 Sample Road (register number 9100011), floor 2, by a text: not reached; the round has closed and the row is kept for the Hub's follow-up`,
    );
    const lines = heldRecordLines({ ...NOTHING, checkins: { kind: "rows", rows: [{ at: new Date("2026-10-06T13:00:00Z"), description: "in the check-in round" }] } });
    expect(lines).toContain("Check-in records (1):");
    expect(lines).toContain("  2026-10-06 09:00  in the check-in round");
  });

  it("says when nothing is held, and never calls a check-in table it cannot read nothing", () => {
    expect(nothingHeld(NOTHING)).toBe(true);
    expect(heldRecordLines(NOTHING)).toContain("Nothing is held for this number.");
    expect(heldRecordLines(NOTHING)).toContain("Check-in records: none (check-ins are not built yet)");

    const unreadable: HeldRecord = { ...NOTHING, checkins: { kind: "unreadable" } };
    expect(nothingHeld(unreadable)).toBe(false);
    expect(heldRecordLines(unreadable).join("\n")).toMatch(/A CHECK-IN TABLE EXISTS THAT THIS SCRIPT CANNOT READ YET\. Do not answer the request as complete/);
    expect(nothingHeld({ ...NOTHING, checkins: { kind: "rows", rows: [] } })).toBe(true);
    expect(nothingHeld({ ...NOTHING, hashes: [{ scope: "signup_info", count: 1, latest: NOW }] })).toBe(false);
  });

  it("says loudly what is held that it cannot read yet, and never calls that nothing", () => {
    const unread: HeldRecord = { ...NOTHING, unread: ["subscriber.checkin_method", "the table checkin_request (it refers to subscriber)"] };

    expect(nothingHeld(unread)).toBe(false);
    expect(heldRecordLines(unread).join("\n")).toContain(
      "NOT SHOWN: THE CVH HOLDS MORE FOR THIS NUMBER THAN THIS SCRIPT CAN READ YET (subscriber.checkin_method; the table checkin_request (it refers to subscriber)). Do not answer the request as complete",
    );
    expect(heldRecordLines(NOTHING).join("\n")).not.toContain("NOT SHOWN");
  });
});

describe("deletionSummary", () => {
  it("names the masked number and what a deletion would remove, so a mistyped number is noticed first", () => {
    expect(deletionSummary(NOTHING)).toBe("For +1 ••• ••• 0123 the CVH holds no subscriber, no pending sign-up, 0 waiting replies and 0 texts on record.");
    const held: HeldRecord = {
      ...NOTHING,
      subscriber: {
        since: new Date("2026-10-01T14:00:00Z"),
        lang: "ur",
        neighbourhood: "Thorncliffe Park (TP)",
        groups: [],
        consentVersion: "2026-10-02.1",
        startedBy: "web",
        retentionState: "active",
        reconsent: null,
        places: [],
        mutedTopics: [],
        prompt: null,
        editLink: null,
        checkinRequest: null,
      },
      replies: [{ since: NOW, expiresAt: NOW }],
      texts: [{ createdAt: NOW, kind: "transactional", purpose: "welcome", lang: "ur", state: "delivered", segments: 1, resendN: null, providerErrorCode: null }],
    };
    expect(deletionSummary(held)).toBe("For +1 ••• ••• 0123 the CVH holds a subscriber since 2026-10-01 10:00, no pending sign-up, 1 waiting reply and 1 text on record.");
  });
});
