import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en.json";
import ur from "@/i18n/messages/ur.json";
import type { Shown } from "./home-view";
import { StatusMark, ThreadLinks, Unverified } from "./place-status";

const render = (node: React.ReactNode, lang: "en" | "ur" = "en") =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={lang} messages={(lang === "ur" ? ur : en) as unknown as AbstractIntlMessages}>
      {node}
    </NextIntlClientProvider>,
  );
const status = (value: "none" | "active" | "in_progress" | "resolved", verified = true): Shown => ({ kind: "status", status: value, verified });

describe("StatusMark (FR-D6, UX-DR5)", () => {
  it.each([
    ["active", "Active problem", "statusActive"],
    ["in_progress", "Work in progress", "statusProgress"],
    ["resolved", "Resolved", "statusResolved"],
  ] as const)("shows %s as its words and its icon, never colour alone", (value, words, icon) => {
    const html = render(<StatusMark shown={status(value)} />);

    expect(html).toContain(`data-status="${value}"`);
    expect(html).toContain(words);
    expect(html).toContain(`home-ico home-ico--${icon}`);
  });

  it("says Nothing active, with its own icon, for a place with no status", () => {
    const html = render(<StatusMark shown={status("none")} />);

    expect(html).toContain("Nothing active");
    expect(html).toContain("home-ico--none");
  });

  it("reads the words in the page's language", () => {
    expect(render(<StatusMark shown={status("active")} />, "ur")).toContain("فعال مسئلہ");
  });
});

describe("Unverified", () => {
  it("says Not yet verified when the status rests on unverified reports only", () => {
    expect(render(<Unverified shown={status("active", false)} />)).toContain("Not yet verified");
  });

  it("says nothing for a verified status, for none, or for a place not known", () => {
    expect(render(<Unverified shown={status("active", true)} />)).toBe("");
    expect(render(<Unverified shown={status("none", false)} />)).toBe("");
    expect(render(<Unverified shown={{ kind: "unknown" }} />)).toBe("");
  });
});

describe("ThreadLinks (S05.06)", () => {
  it("links each thread behind the status to its alert, named by its types", () => {
    const html = render(<ThreadLinks behind={[{ slug: "kbcdfghj", types: ["power", "water"] }, { slug: "mnpqrstv", types: ["mystery"] }]} lang="en" testId="threads" />);

    expect(html).toContain('href="/en/alerts/kbcdfghj"');
    expect(html).toContain("Power, Water");
    expect(html).toContain('href="/en/alerts/mnpqrstv"');
    expect(html).toContain("Other");
    expect(html).toContain("tap");
  });

  it("renders nothing when no thread is behind the status", () => {
    expect(render(<ThreadLinks behind={[]} lang="en" testId="threads" />)).toBe("");
  });
});
