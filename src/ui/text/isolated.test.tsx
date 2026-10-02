import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Isolated, Words, isolatedInString, withIsolated } from "./isolated";

describe("Isolated", () => {
  it("is an isolated left-to-right English run", () => {
    expect(renderToStaticMarkup(<Isolated>10 Overlea Blvd</Isolated>)).toBe('<bdi lang="en" dir="ltr">10 Overlea Blvd</bdi>');
  });
});

describe("isolatedInString", () => {
  it("surrounds the item with FIRST STRONG ISOLATE and POP DIRECTIONAL ISOLATE", () => {
    expect(isolatedInString("4 Milepost Pl")).toBe("⁨4 Milepost Pl⁩");
  });
});

describe("Words", () => {
  it("is the catalog's string as it is, or an isolated run with isolate, or the element it was given", () => {
    expect(renderToStaticMarkup(<Words>منزل</Words>)).toBe("منزل");
    expect(renderToStaticMarkup(<Words isolate>4 Milepost Pl</Words>)).toBe('<bdi lang="en" dir="ltr">4 Milepost Pl</bdi>');
    expect(renderToStaticMarkup(<Words isolate>{<i>x</i>}</Words>)).toBe("<i>x</i>");
  });
});

describe("withIsolated", () => {
  const floor = (n: string) => `منزل ${n}`;

  it("isolates the value inside the message and leaves the message's own words as they are", () => {
    expect(renderToStaticMarkup(<>{withIsolated(floor, "2B")}</>)).toBe('منزل <bdi lang="en" dir="ltr">2B</bdi>');
  });

  it("can leave the direction to the text, for what the resident typed", () => {
    expect(renderToStaticMarkup(<>{withIsolated((q) => `کوئی عمارت "${q}" سے نہیں ملتی۔`, "ابھی", "auto")}</>)).toBe('کوئی عمارت &quot;<bdi dir="auto">ابھی</bdi>&quot; سے نہیں ملتی۔');
  });

  it("makes a message that fell back to English one isolated English run", () => {
    expect(renderToStaticMarkup(<>{withIsolated((n) => `[EN] Floor ${n}`, "G")}</>)).toBe('<bdi lang="en" dir="ltr">[EN] Floor <bdi lang="en" dir="ltr">G</bdi></bdi>');
  });

  it("escapes the value", () => {
    expect(renderToStaticMarkup(<>{withIsolated(floor, "<b>")}</>)).toContain("&lt;b&gt;");
  });
});
