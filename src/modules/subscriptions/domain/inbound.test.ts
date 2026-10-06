import { describe, expect, it } from "vitest";
import { LAUNCH_CODES } from "../../../i18n/languages";
import { residentText } from "../../../i18n/residentTexts";
import { INBOUND_KEYWORDS, INBOUND_LIMIT, decide, exemptFromInboundLimit, isMessageSid, normaliseReply, readKeyword, yesWordsOf, type InboundKeyword, type NumberState } from "./inbound";

const key = (body: string, optOutType: string | null = null, yesWords: readonly string[] = []) => readKeyword({ body, optOutType, yesWords });

describe("reply normalisation (E07 'Reply normalisation')", () => {
  it("trims, case-folds, drops punctuation and symbols at the ends and direction marks, and collapses spaces", () => {
    expect(normaliseReply("  Yes!  ")).toBe("yes");
    expect(normaliseReply("‏YES.‏")).toBe("yes");
    expect(normaliseReply("ＹＥＳ")).toBe("yes");
    expect(normaliseReply("(0)")).toBe("0");
    expect(normaliseReply("yes   please")).toBe("yes please");
    expect(normaliseReply("👍 yes 👍")).toBe("yes");
  });

  it("reads digits in every script residents type as 0-9 (toAsciiDigits)", () => {
    const zeroToThree: Record<string, string[]> = {
      urdu: ["۰", "۱", "۲", "۳"],
      arabic: ["٠", "١", "٢", "٣"],
      bengali: ["০", "১", "২", "৩"],
      gujarati: ["૦", "૧", "૨", "૩"],
      devanagari: ["०", "१", "२", "३"],
      gurmukhi: ["੦", "੧", "੨", "੩"],
      tamil: ["௦", "௧", "௨", "௩"],
      fullWidth: ["０", "１", "２", "３"],
    };
    for (const [script, digits] of Object.entries(zeroToThree)) {
      expect(digits.map(normaliseReply), script).toEqual(["0", "1", "2", "3"]);
      expect(digits.map((digit) => key(digit)), script).toEqual(["0", "1", "2", "3"]);
    }
  });
});

describe("the keyword of a message", () => {
  it("is Twilio's OptOutType first, whatever the body says", () => {
    expect(key("anything", "STOP")).toBe("stop");
    expect(key("YES", "START")).toBe("start");
    expect(key("0", "HELP")).toBe("help");
    expect(key("Hello", "stop")).toBe("stop");
  });

  it("reads Twilio's opt-out words as STOP even without OptOutType (a STOP is never answered)", () => {
    for (const word of ["STOP", "stop", "Stop.", "STOPALL", "unsubscribe", "Cancel", "END", "quit"]) expect(key(word), word).toBe("stop");
    expect(key("START")).toBe("start");
    expect(key("help")).toBe("help");
  });

  it("reads YES as YES or Y in any case, and the language's own word for yes only when given", () => {
    for (const word of ["YES", "yes", "Yes", "Y", "y", " yes. "]) expect(key(word), word).toBe("yes");
    expect(key("oui")).toBe("other");
    expect(key("Oui", null, ["oui"])).toBe("yes");
    expect(key("ہاں", null, yesWordsOf(residentText("ur", "yesWords")))).toBe("yes");
    expect(key("Sí", null, yesWordsOf(residentText("es", "yesWords")))).toBe("yes");
    expect(key("si", null, yesWordsOf(residentText("es", "yesWords")))).toBe("yes");
    expect(key("yes please")).toBe("other");
  });

  it("has a word for yes in every launch language's catalog", () => {
    for (const lang of LAUNCH_CODES) expect(yesWordsOf(residentText(lang, "yesWords")).length, lang).toBeGreaterThan(0);
  });

  it("reads a single digit 0 to 3 as itself and anything else as other", () => {
    expect(["0", "1", "2", "3"].map((d) => key(d))).toEqual(["0", "1", "2", "3"]);
    for (const body of ["4", "10", "01", "", "hello", "1 2", "Building 12"]) expect(key(body), body).toBe("other");
  });
});

describe("the decision table (E07 'Decision table': a test for every keyword, state and open prompt)", () => {
  const states: { name: string; state: NumberState }[] = [
    { name: "none", state: { kind: "none" } },
    { name: "pending", state: { kind: "pending" } },
    { name: "active, no prompt", state: { kind: "active", prompt: "none" } },
    { name: "active, delete prompt open", state: { kind: "active", prompt: "delete_confirm" } },
  ];
  // [keyword, state name] -> [action, prompt cancelled]
  const table: Record<InboundKeyword, Record<string, [string, boolean]>> = {
    stop: { none: ["delete", false], pending: ["delete", false], "active, no prompt": ["delete", false], "active, delete prompt open": ["delete", false] },
    start: { none: ["none", false], pending: ["none", false], "active, no prompt": ["none", false], "active, delete prompt open": ["none", false] },
    help: { none: ["none", false], pending: ["none", false], "active, no prompt": ["none", false], "active, delete prompt open": ["none", false] },
    yes: { none: ["signup_info", false], pending: ["confirm", false], "active, no prompt": ["already_signed_up", false], "active, delete prompt open": ["already_signed_up", true] },
    "0": { none: ["signup_info", false], pending: ["none", false], "active, no prompt": ["ask_delete", false], "active, delete prompt open": ["delete", false] },
    "1": { none: ["signup_info", false], pending: ["none", false], "active, no prompt": ["menu", false], "active, delete prompt open": ["menu", true] },
    "2": { none: ["signup_info", false], pending: ["none", false], "active, no prompt": ["menu", false], "active, delete prompt open": ["menu", true] },
    "3": { none: ["signup_info", false], pending: ["none", false], "active, no prompt": ["menu", false], "active, delete prompt open": ["menu", true] },
    other: { none: ["signup_info", false], pending: ["none", false], "active, no prompt": ["none", false], "active, delete prompt open": ["none", true] },
  };

  // S07.05's prompts: a menu open (every reply but STOP, START and HELP is the menu's, 0 being Back), a menu idle for 10 minutes (it has
  // reset: the reply says so and is read as a new keyword with no prompt), and the edit link's offer (1 asks for the link).
  states.push(
    { name: "active, menu open", state: { kind: "active", prompt: "menu" } },
    { name: "active, menu idle 10 minutes", state: { kind: "active", prompt: "menu_idle" } },
    { name: "active, edit link offered", state: { kind: "active", prompt: "edit_link_offer" } },
  );
  const menuRows: Record<InboundKeyword, [[string, boolean], [string, boolean], [string, boolean]]> = {
    stop: [["delete", false], ["delete", false], ["delete", false]],
    start: [["none", false], ["none", false], ["none", false]],
    help: [["none", false], ["none", false], ["none", false]],
    yes: [["menu_reply", false], ["already_signed_up", true], ["already_signed_up", true]],
    "0": [["menu_reply", false], ["ask_delete", true], ["ask_delete", true]],
    "1": [["menu_reply", false], ["menu", true], ["edit_link", true]],
    "2": [["menu_reply", false], ["menu", true], ["menu", true]],
    "3": [["menu_reply", false], ["menu", true], ["menu", true]],
    other: [["menu_reply", false], ["none", true], ["none", true]],
  };
  for (const keyword of INBOUND_KEYWORDS) {
    const [open, idle, offer] = menuRows[keyword];
    Object.assign(table[keyword], { "active, menu open": open, "active, menu idle 10 minutes": idle, "active, edit link offered": offer });
  }

  for (const keyword of INBOUND_KEYWORDS) {
    for (const { name, state } of states) {
      it(`${keyword} from a number that is ${name}: ${table[keyword][name]![0]}${table[keyword][name]![1] ? ", and the prompt is cancelled" : ""}`, () => {
        const [action, cancelled] = table[keyword][name]!;
        const decision = decide(keyword, state);
        expect(decision.action.kind).toBe(action);
        expect(decision.cancelPrompt).toBe(cancelled);
        if (action === "menu") expect(decision.action).toEqual({ kind: "menu", choice: keyword });
        // The reset is said exactly when an idle menu gets a reply the router answers (not STOP, START or HELP: Twilio's).
        const resets = state.kind === "active" && state.prompt === "menu_idle" && !["stop", "start", "help"].includes(keyword);
        expect(decision.menuReset ?? false).toBe(resets);
      });
    }
  }

  it("reads 0 inside a menu as Back (a menu reply), never as a deletion, so it is limited like any other menu reply", () => {
    const menu: NumberState = { kind: "active", prompt: "menu" };
    for (const zero of ["0", "۰", "০", "૦"]) {
      const { action } = decide(key(zero), menu);
      expect(action, zero).toEqual({ kind: "menu_reply" });
      expect(exemptFromInboundLimit("0", action)).toBe(false);
    }
  });

  it("decides the same for a 0 typed in Urdu, Bengali or Gujarati digits as for 0", () => {
    const active: NumberState = { kind: "active", prompt: "none" };
    const confirming: NumberState = { kind: "active", prompt: "delete_confirm" };
    for (const zero of ["۰", "০", "૦", "０"]) {
      expect(decide(key(zero), active).action.kind, zero).toBe("ask_delete");
      expect(decide(key(zero), confirming).action.kind, zero).toBe("delete");
    }
    for (const two of ["۲", "২", "૨", "２"]) expect(decide(key(two), active).action, two).toEqual({ kind: "menu", choice: "2" });
  });
});

describe("a Twilio MessageSid", () => {
  it("is SM or MM and 32 hex digits", () => {
    expect(isMessageSid(`SM${"a".repeat(32)}`)).toBe(true);
    expect(isMessageSid(`MM${"0".repeat(32)}`)).toBe(true);
    for (const bad of [null, undefined, "", "SM123", `XX${"a".repeat(32)}`, `SM${"g".repeat(32)}`]) expect(isMessageSid(bad)).toBe(false);
  });
});

describe("the inbound limit (S07.09, E07 'Inbound order': opt-out events and deletion before rate limits)", () => {
  const states: NumberState[] = [{ kind: "none" }, { kind: "pending" }, { kind: "active", prompt: "none" }, { kind: "active", prompt: "delete_confirm" }];

  it("is 20 messages in an hour", () => {
    expect(INBOUND_LIMIT).toEqual({ perHour: 20, windowMs: 3_600_000 });
  });

  it("never limits a deletion request (either 0) or an opt-out event, whatever the number's state", () => {
    for (const state of states) {
      expect(exemptFromInboundLimit("stop", decide("stop", state).action)).toBe(true);
      expect(exemptFromInboundLimit("start", decide("start", state).action)).toBe(true);
      expect(exemptFromInboundLimit("help", decide("help", state).action)).toBe(true);
    }
    // The second 0 within 10 minutes is a deletion.
    expect(exemptFromInboundLimit("0", decide("0", { kind: "active", prompt: "delete_confirm" }).action)).toBe(true);
    // The first 0 opens the confirmation: it is a deletion request too, so a limited subscriber can still start leaving.
    expect(exemptFromInboundLimit("0", decide("0", { kind: "active", prompt: "none" }).action)).toBe(true);
  });

  it("limits everything else: a YES, a menu choice, any other text, from any state", () => {
    for (const state of states) {
      for (const keyword of ["yes", "0", "1", "2", "3", "other"] as const) {
        const { action } = decide(keyword, state);
        expect(exemptFromInboundLimit(keyword, action), `${keyword} in ${JSON.stringify(state)}`).toBe(action.kind === "delete" || action.kind === "ask_delete");
      }
    }
    expect(exemptFromInboundLimit("0", decide("0", { kind: "none" }).action)).toBe(false);
  });
});

describe("the decision table's re-consent rows (S09.07: a test for every keyword from a subscriber asked to re-consent, and from one past the deadline)", () => {
  const states: { name: string; state: NumberState }[] = [
    { name: "asked", state: { kind: "active", prompt: "none", reconsent: true } },
    { name: "asked, delete prompt open", state: { kind: "active", prompt: "delete_confirm", reconsent: true } },
    { name: "lapsed", state: { kind: "lapsed" } },
  ];
  // [keyword, state name] -> [action, prompt cancelled]
  const table: Record<InboundKeyword, Record<string, [string, boolean]>> = {
    stop: { asked: ["delete", false], "asked, delete prompt open": ["delete", false], lapsed: ["delete", false] },
    start: { asked: ["none", false], "asked, delete prompt open": ["none", false], lapsed: ["none", false] },
    help: { asked: ["none", false], "asked, delete prompt open": ["none", false], lapsed: ["none", false] },
    yes: { asked: ["reconsent", false], "asked, delete prompt open": ["reconsent", true], lapsed: ["pilot_ended", false] },
    "0": { asked: ["ask_delete", false], "asked, delete prompt open": ["delete", false], lapsed: ["none", false] },
    "1": { asked: ["menu", false], "asked, delete prompt open": ["menu", true], lapsed: ["none", false] },
    "2": { asked: ["menu", false], "asked, delete prompt open": ["menu", true], lapsed: ["none", false] },
    "3": { asked: ["menu", false], "asked, delete prompt open": ["menu", true], lapsed: ["none", false] },
    other: { asked: ["none", false], "asked, delete prompt open": ["none", true], lapsed: ["none", false] },
  };

  // With S07.05's prompts, which a subscriber asked to re-consent may open after the campaign's start took the row (the prompt written last wins,
  // AD-9): inside an open menu every reply but STOP, START and HELP is the menu's, YES included (the subscriber stays asked); a menu idle for
  // 10 minutes has reset and the reply is read as a new keyword, so YES then resolves to the re-consent; the edit link's offer is cancelled by YES.
  states.push(
    { name: "asked, menu open", state: { kind: "active", prompt: "menu", reconsent: true } },
    { name: "asked, menu idle 10 minutes", state: { kind: "active", prompt: "menu_idle", reconsent: true } },
    { name: "asked, edit link offered", state: { kind: "active", prompt: "edit_link_offer", reconsent: true } },
  );
  const menuRows: Record<InboundKeyword, [[string, boolean], [string, boolean], [string, boolean]]> = {
    stop: [["delete", false], ["delete", false], ["delete", false]],
    start: [["none", false], ["none", false], ["none", false]],
    help: [["none", false], ["none", false], ["none", false]],
    yes: [["menu_reply", false], ["reconsent", true], ["reconsent", true]],
    "0": [["menu_reply", false], ["ask_delete", true], ["ask_delete", true]],
    "1": [["menu_reply", false], ["menu", true], ["edit_link", true]],
    "2": [["menu_reply", false], ["menu", true], ["menu", true]],
    "3": [["menu_reply", false], ["menu", true], ["menu", true]],
    other: [["menu_reply", false], ["none", true], ["none", true]],
  };
  for (const keyword of INBOUND_KEYWORDS) {
    const [open, idle, offer] = menuRows[keyword];
    Object.assign(table[keyword], { "asked, menu open": open, "asked, menu idle 10 minutes": idle, "asked, edit link offered": offer });
  }

  for (const keyword of INBOUND_KEYWORDS) {
    for (const { name, state } of states) {
      it(`${keyword} from a subscriber who is ${name}: ${table[keyword][name]![0]}${table[keyword][name]![1] ? ", and the prompt is cancelled" : ""}`, () => {
        const [action, cancelled] = table[keyword][name]!;
        const decision = decide(keyword, state);
        expect(decision.action.kind).toBe(action);
        expect(decision.cancelPrompt).toBe(cancelled);
        const resets = state.kind === "active" && state.prompt === "menu_idle" && !["stop", "start", "help"].includes(keyword);
        expect(decision.menuReset ?? false).toBe(resets);
      });
    }
  }

  it("never limits a YES to the campaign (it keeps the subscriber, once); a lapsed subscriber's YES is limited, and their STOP never", () => {
    // Asked and not yet kept, outside a menu, whatever other prompt is open: the YES is the re-consent and is decided before the limit.
    for (const prompt of ["none", "delete_confirm", "edit_link_offer", "menu_idle"] as const) {
      const { action } = decide("yes", { kind: "active", prompt, reconsent: true });
      expect(action.kind, prompt).toBe("reconsent");
      expect(exemptFromInboundLimit("yes", action), prompt).toBe(true);
    }
    // Inside an open menu YES is the menu's (the page again), limited as any menu reply; once kept, a YES is an ordinary reply.
    expect(exemptFromInboundLimit("yes", decide("yes", { kind: "active", prompt: "menu", reconsent: true }).action)).toBe(false);
    expect(exemptFromInboundLimit("yes", decide("yes", { kind: "active", prompt: "none" }).action)).toBe(false);
    expect(exemptFromInboundLimit("yes", decide("yes", { kind: "lapsed" }).action)).toBe(false);
    expect(exemptFromInboundLimit("stop", decide("stop", { kind: "lapsed" }).action)).toBe(true);
  });
});
