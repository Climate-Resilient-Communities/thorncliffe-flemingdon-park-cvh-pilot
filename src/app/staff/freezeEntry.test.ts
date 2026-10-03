import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/platform/config/env";
import { freezeEntryContent } from "./freezeEntry";

const AUDIENCE = { scope: "neighbourhood" as const, neighbourhood_ids: ["TP"], groups: [], types: ["power"] };

const input = {
  alertId: "01900000-0000-7000-8000-0000000000a1",
  kind: "ack" as const,
  supersedesId: null,
  isDrill: false,
  channels: ["sms", "web"],
  content: { text: "Power is out.", types: ["power"], audience: AUDIENCE, phase: "problem" as const, validUntil: new Date("2026-10-03T18:00:00Z") },
  translations: [],
  verified: true,
  attribution: { role: "hub" as const },
  slug: "k3x9a2",
};

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("freezeEntryContent", () => {
  it("links to /a/{slug} under the origin it is given", () => {
    const result = freezeEntryContent(input, { publicBaseUrl: "https://cvh.example" });

    expect(result.ok && result.value.smsBodies.en.body).toContain("More: https://cvh.example/a/k3x9a2");
  });

  it("reads PUBLIC_BASE_URL through the validated environment when no origin is given", () => {
    vi.stubEnv("SMS_MODE", "log");
    vi.stubEnv("PUBLIC_BASE_URL", "http://localhost:4010");
    resetEnvCache();

    const result = freezeEntryContent(input);

    expect(result.ok && result.value.smsBodies.en.body).toContain("More: http://localhost:4010/a/k3x9a2");
  });

  it("fails like the rest of the app when the environment is unsafe, instead of linking to a wrong origin", () => {
    vi.stubEnv("SMS_MODE", "live");
    vi.stubEnv("PUBLIC_BASE_URL", "http://localhost:4010");
    vi.spyOn(console, "error").mockImplementation(() => {});
    resetEnvCache();

    expect(() => freezeEntryContent(input)).toThrow(/SMS_MODE/);
  });
});
