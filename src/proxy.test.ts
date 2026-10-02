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

  it("leaves the root, staff and other paths alone", () => {
    for (const path of ["/", "/staff/sign-in", "/api/health", "/hello"]) {
      const response = proxy(request(path));

      expect(response.headers.get("location"), path).toBeNull();
      expect(response.headers.get("set-cookie"), path).toBeNull();
    }
  });
});
