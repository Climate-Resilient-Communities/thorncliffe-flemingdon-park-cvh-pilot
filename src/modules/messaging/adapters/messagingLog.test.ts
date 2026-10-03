import { afterEach, describe, expect, it, vi } from "vitest";
import { stdoutMessagingLog } from "./messagingLog";

describe("the messaging log", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes one JSON line per event with the module, and masks a phone number that reaches any text field to its last two digits", () => {
    const written: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void written.push(line));
    stdoutMessagingLog.info("contact.resolved", { delivery_id: "d1", number: "+14165550123", ms: 12, consumed: true, note: null });
    stdoutMessagingLog.error("provider.error", { detail: "invalid number +14165550123 (416) 555-0123" });
    expect(written.map((line) => JSON.parse(line))).toEqual([
      { level: "info", evt: "contact.resolved", module: "messaging", delivery_id: "d1", number: "+*********23", ms: 12, consumed: true, note: null },
      { level: "error", evt: "provider.error", module: "messaging", detail: "invalid number +*********23 (***) ***-**23" },
    ]);
    expect(written.join("\n")).not.toContain("4165550123");
    expect(written.join("\n")).not.toContain("555-0123");
  });
});
