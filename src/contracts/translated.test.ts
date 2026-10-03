import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/platform/hash";
import { TRANSLATED_STATUSES, TranslatedSchema } from "./translated";

const HASH = sha256Hex("The elevator is out of service.");

const text = (change: Record<string, unknown> = {}) => ({ lang: "ur", body: "لفٹ بند ہے۔", machine: true, model: "north-small-translate-09-2026", status: "ok", source_hash: HASH, ...change });
const english = (change: Record<string, unknown> = {}) => ({ lang: "en", body: "The elevator is out of service.", machine: false, model: null, status: "source", source_hash: HASH, ...change });
const fallback = (change: Record<string, unknown> = {}) => ({ lang: "ta", body: "The elevator is out of service.", machine: false, model: null, status: "fallback_en", source_hash: HASH, ...change });
const converted = (change: Record<string, unknown> = {}) => ({
  lang: "zh-Hant",
  body: "電梯停止運行。",
  machine: true,
  model: "opencc-js 1.4.2",
  status: "script_converted",
  source_hash: HASH,
  conversion: { from: "zh", from_text_hash: sha256Hex("电梯停止运行。"), opencc_version: "1.4.2", config: "opencc-js Converter({ from: \"cn\", to: \"twp\" }) (OpenCC s2twp)" },
  ...change,
});

describe("Translated (AD-20)", () => {
  it("knows the four statuses of the spine", () => {
    expect([...TRANSLATED_STATUSES]).toEqual(["source", "ok", "fallback_en", "script_converted"]);
  });

  it("accepts a model's translation, the English source, the English fallback and a converted zh-Hant text", () => {
    for (const valid of [text(), english(), fallback(), converted()]) expect(TranslatedSchema.safeParse(valid).success).toBe(true);
  });

  it("is exactly {lang, body, machine, model, status, source_hash}, with a conversion only on a converted text", () => {
    expect(Object.keys(TranslatedSchema.parse(text())).sort()).toEqual(["body", "lang", "machine", "model", "source_hash", "status"]);
    expect(Object.keys(TranslatedSchema.parse(converted())).sort()).toEqual(["body", "conversion", "lang", "machine", "model", "source_hash", "status"]);
  });

  it.each([
    ["a language code that is not one of ours", text({ lang: "fa" })],
    ["a vendor's language code", text({ lang: "bn-IN" })],
    ["an empty body", text({ body: "" })],
    ["a source hash that is not a sha256", text({ source_hash: "abc" })],
    ["a status that is not one of the four", text({ status: "translated" })],
    ["a field it does not know", text({ notice: "translation.unavailable" })],
    ["a translation that is not machine text", text({ machine: false })],
    ["a translation with no model", text({ model: null })],
    ["a source that is not English", english({ lang: "fr" })],
    ["a source with a model", english({ model: "m" })],
    ["a translation into English", text({ lang: "en" })],
    ["a fallback that claims a model", fallback({ model: "north-small-translate-09-2026" })],
    ["a fallback that claims to be machine text", fallback({ machine: true })],
    ["a converted text that is not zh-Hant", converted({ lang: "zh" })],
    ["a converted text with no conversion", converted({ conversion: undefined })],
    ["a converted text that is not machine text", converted({ machine: false })],
    ["a conversion from something other than zh", converted({ conversion: { ...converted().conversion, from: "ur" } })],
    ["a conversion on a text that was not converted", text({ conversion: converted().conversion })],
  ])("rejects %s", (_name, value) => {
    expect(TranslatedSchema.safeParse(value).success).toBe(false);
  });
});
