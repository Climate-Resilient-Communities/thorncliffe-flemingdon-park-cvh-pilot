import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NUMBERS_PAGE_EXISTS, numbersHref } from "./numbers-route";

const ROOT = path.join(__dirname, "..", "..", "..");

describe("the link to the essential numbers page (S02.10)", () => {
  it("is shown exactly when the page exists: turn it on in numbers-route.ts when src/app/[lang]/ready/numbers/page.tsx is merged", () => {
    const pageExists = existsSync(path.join(ROOT, "src", "app", "[lang]", "ready", "numbers", "page.tsx"));

    expect(NUMBERS_PAGE_EXISTS).toBe(pageExists);
  });

  it("opens the numbers page of the page's language", () => {
    expect(numbersHref("ur")).toBe("/ur/ready/numbers");
  });
});
