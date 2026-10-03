import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator, type AbstractIntlMessages } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { LAUNCH_LANGUAGES } from "@/i18n/languages";
import en from "@/i18n/messages/en.json";
import ur from "@/i18n/messages/ur.json";
import { ICONS, lightColour, webAppManifest } from "./manifest";

vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace?: string }) =>
    createTranslator({ locale, messages: (locale === "ur" ? ur : en) as unknown as AbstractIntlMessages, namespace } as never),
}));

const { GET } = await import("./route");

const PUBLIC = path.join(__dirname, "..", "..", "..", "..", "public");

/** Width and height of a PNG, from its header. */
function pngSize(file: string): [number, number] {
  const bytes = readFileSync(file);
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe("the web app manifest (S02.12): installable from the browser, no app store", () => {
  it("names the CVH, opens on the language's home and carries its direction", () => {
    for (const language of LAUNCH_LANGUAGES) {
      const manifest = webAppManifest(language, "Community Virtual Hub");
      expect(manifest).toMatchObject({ id: "/", name: "Community Virtual Hub", start_url: `/${language.code}`, scope: "/", display: "standalone", lang: language.bcp47, dir: language.dir });
    }
    expect(webAppManifest({ code: "ur", bcp47: "ur", dir: "rtl" }, "x").dir).toBe("rtl");
    // A name that fell back to English is shown without the marker.
    expect(webAppManifest({ code: "ps", bcp47: "ps", dir: "rtl" }, "[EN] Community Virtual Hub").name).toBe("Community Virtual Hub");
  });

  it("takes its colours from the design tokens", () => {
    const manifest = webAppManifest({ code: "en", bcp47: "en", dir: "ltr" }, "x");
    expect(manifest.background_color).toBe(lightColour("surface"));
    expect(manifest.theme_color).toBe(lightColour("surface-raised"));
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("lists icons that exist at the sizes it says, with a 192 and a 512 any and a 512 maskable", () => {
    for (const icon of ICONS) {
      const file = path.join(PUBLIC, icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      const [width, height] = pngSize(file);
      expect(`${width}x${height}`).toBe(icon.sizes);
    }
    expect(ICONS.map((icon) => `${icon.sizes} ${icon.purpose}`)).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
    expect(pngSize(path.join(PUBLIC, "icons", "apple-touch-icon.png"))).toEqual([180, 180]);
  });

  it("is served in the language's own words as application/manifest+json", async () => {
    const response = await GET(new Request("https://cvh.example/ur/manifest.webmanifest"), { params: Promise.resolve({ lang: "ur" }) });
    expect(response.headers.get("content-type")).toContain("application/manifest+json");
    const body = await response.json();
    expect(body).toMatchObject({ start_url: "/ur", dir: "rtl", lang: "ur" });
    expect(body.name).toBe(ur.shell.cvhName);
    expect((await GET(new Request("https://cvh.example/de/manifest.webmanifest"), { params: Promise.resolve({ lang: "de" }) })).status).toBe(404);
  });
});
