import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

const request = (path: string) => new NextRequest(`http://localhost:3000${path}`);

describe("proxy", () => {
  it("sends an unknown language code to the same path under /en/, keeping the query", () => {
    const response = proxy(request("/xx/buildings/12?floor=3"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/en/buildings/12?floor=3");
  });

  it("sends Traditional Chinese to the same path under /zh/, a conversion of the zh content (D-5)", () => {
    const response = proxy(request("/zh-Hant/ready?x=1"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/zh/ready?x=1");
  });

  it("passes a launch language through without setting a cookie or a Link header (AD-3)", () => {
    for (const path of ["/ur", "/prs/map", "/en/", "/zh/buildings/1"]) {
      const response = proxy(request(path));

      expect(response.status, path).toBe(200);
      expect(response.headers.get("location"), path).toBeNull();
      expect(response.headers.get("set-cookie"), path).toBeNull();
      expect(response.headers.get("link"), path).toBeNull();
    }
  });

  describe("the share link /a/{slug}?l={lang} (S05.08)", () => {
    const rewrite = (path: string) => proxy(request(path)).headers.get("x-middleware-rewrite");

    it("is answered by the alert page of the language in `l`, behind the same address, with no redirect and no cookie", () => {
      for (const lang of ["en", "ur", "prs", "zh", "fr"]) {
        const response = proxy(request(`/a/kbcdfghj?l=${lang}`));

        expect(response.status, lang).toBe(200);
        expect(response.headers.get("x-middleware-rewrite"), lang).toBe(`http://localhost:3000/${lang}/a/kbcdfghj`);
        expect(response.headers.get("location"), lang).toBeNull();
        expect(response.headers.get("set-cookie"), lang).toBeNull();
        expect(response.headers.get("link"), lang).toBeNull();
      }
    });

    it("is English when `l` is missing, empty or not one of our languages, and never redirects to guess one", () => {
      for (const path of ["/a/kbcdfghj", "/a/kbcdfghj?l=", "/a/kbcdfghj?l=xx", "/a/kbcdfghj?l=EN", "/a/kbcdfghj?l=../staff", "/a/kbcdfghj?x=ur"]) {
        expect(rewrite(path), path).toBe("http://localhost:3000/en/a/kbcdfghj");
      }
    });

    it("sends Traditional Chinese to zh, a conversion of the zh content (D-5)", () => {
      expect(rewrite("/a/kbcdfghj?l=zh-Hant")).toBe("http://localhost:3000/zh/a/kbcdfghj");
    });

    it("answers only an address of one segment after /a, and a trailing slash is the same address", () => {
      expect(rewrite("/a/kbcdfghj/?l=ur")).toBe("http://localhost:3000/ur/a/kbcdfghj");
      for (const path of ["/a", "/a/", "/a/kbcdfghj/more", "/ab/kbcdfghj"]) expect(rewrite(path), path).toBeNull();
    });
  });

  it("leaves the root, staff and other paths alone", () => {
    for (const path of ["/", "/staff/sign-in", "/api/health", "/hello"]) {
      const response = proxy(request(path));

      expect(response.headers.get("location"), path).toBeNull();
      expect(response.headers.get("set-cookie"), path).toBeNull();
    }
  });
});
