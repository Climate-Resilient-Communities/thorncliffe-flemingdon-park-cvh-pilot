import { describe, expect, it } from "vitest";
import { pathInLanguage, unknownLanguageRedirect } from "./paths";

describe("unknownLanguageRedirect", () => {
  it.each([
    ["/xx", "/en"],
    ["/xx/", "/en/"],
    ["/xx/map", "/en/map"],
    ["/xx/buildings/12345", "/en/buildings/12345"],
    ["/EN/map", "/en/map"],
    ["/zh-Hant/ready", "/en/ready"],
    ["/ur-PK", "/en"],
    ["/fra/search", "/en/search"],
  ])("sends %s to %s", (from, to) => {
    expect(unknownLanguageRedirect(from)).toBe(to);
  });

  it.each(["/", "/ur", "/ur/map", "/en", "/prs/x/y", "/staff/sign-in", "/api/health", "/a/ab12", "/hello", "/terms"])(
    "leaves %s alone",
    (path) => {
      expect(unknownLanguageRedirect(path)).toBeNull();
    },
  );
});

describe("pathInLanguage", () => {
  it.each([
    ["/en", "ur", "/ur"],
    ["/en/", "ur", "/ur/"],
    ["/ur/map", "en", "/en/map"],
    ["/ur/buildings/42/floors", "zh", "/zh/buildings/42/floors"],
    ["/en/map/", "fr", "/fr/map/"],
  ])("moves %s to %s: %s", (path, code, expected) => {
    expect(pathInLanguage(path, code as never)).toBe(expected);
  });

  it("puts a language in front of a path that has none", () => {
    expect(pathInLanguage("/", "ur")).toBe("/ur");
    expect(pathInLanguage("/hello/there", "ur")).toBe("/ur/hello/there");
  });
});
