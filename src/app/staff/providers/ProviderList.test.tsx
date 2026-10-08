import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The list imports the server actions; nothing of them runs while rendering to static markup.
vi.mock("./actions", () => ({ confirmProviderAction: async () => ({ status: "idle" }), publishProviderAction: async () => ({ status: "idle" }), unpublishProviderAction: async () => ({ status: "idle" }) }));

import { ProviderList, type ProviderRowData } from "./ProviderList";
import { providerListLabels } from "./labels";

const labels = providerListLabels();

const row = (change: Partial<ProviderRowData> = {}): ProviderRowData => ({
  id: "M001",
  name: "Thorncliffe Neighbourhood Office",
  detail: "M001 · Non-Profits · 45 Overlea Blvd",
  published: false,
  inCatalogue: true,
  lastConfirmed: null,
  ...change,
});

const render = (rows: ProviderRowData[], empty?: string) => renderToStaticMarkup(<ProviderList rows={rows} today="2026-10-02" labels={labels} empty={empty} />);

/** The markup of one part of a row, by its data-testid, up to the end of its element (no nesting of the same tag inside). */
const part = (html: string, testId: string, tag: string) => html.match(new RegExp(`<${tag}[^>]*data-testid="${testId}"[^>]*>[\\s\\S]*?</${tag}>`))?.[0] ?? "";

describe("the providers list: a row's two lines", () => {
  it("line 1 of a confirmed, published provider: its name, the pill 'Published' and the actions menu holding Unpublish", () => {
    const html = render([row({ published: true, lastConfirmed: "2026-10-02" })]);

    expect(html).toContain('<h2 class="provider-row__name">Thorncliffe Neighbourhood Office</h2>');
    expect(html).toMatch(/<span class="provider-pill provider-pill--published" data-testid="provider-M001-status">Published<\/span>/);
    const menu = part(html, "provider-M001-actions", "details");
    expect(menu).toContain('aria-label="Actions for Thorncliffe Neighbourhood Office"');
    expect(menu).toMatch(/<button class="hub-button hub-button--secondary row-actions__item" type="submit">Unpublish<\/button>/);
    expect(menu).not.toContain(">Publish<");
  });

  it("line 2 of a confirmed provider: the blue badge, 'Confirmed Oct 2, 2026' and 'Change', closed", () => {
    const html = render([row({ published: true, lastConfirmed: "2026-10-02" })]);

    const line = part(html, "provider-M001-change", "summary");
    expect(line).toContain('data-testid="provider-M001-confirmed"');
    expect(line).toContain('class="verified verified--yes"');
    expect(line).toContain('<span class="verified__text">Confirmed Oct 2, 2026</span>');
    expect(line).toContain('<span class="provider-row__change">Change</span>');
    expect(html).toMatch(/<details class="provider-row__edit">/);
    expect(html).not.toMatch(/<details class="provider-row__edit" open/);
  });

  it("a provider not confirmed and hidden: the pill 'Hidden', the grey badge with 'Not confirmed' and 'Confirm', and Publish disabled with its reason", () => {
    const html = render([row()]);

    expect(html).toMatch(/provider-pill--hidden" data-testid="provider-M001-status">Hidden</);
    const line = part(html, "provider-M001-change", "summary");
    expect(line).toContain('class="verified verified--no"');
    expect(line).toContain('<span class="verified__text">Not confirmed</span>');
    expect(line).toContain('<span class="provider-row__change">Confirm</span>');
    expect(line).not.toContain("verified__tick");

    const publish = html.match(/<button class="hub-button hub-button--secondary row-actions__item"[^>]*>Publish<\/button>/)?.[0] ?? "";
    expect(publish).toContain('disabled=""');
    expect(publish).toContain('aria-describedby="provider-M001-publish-hint"');
    expect(html).toMatch(/<small id="provider-M001-publish-hint"[^>]*>Confirm this provider first<\/small>/);
  });

  it("a confirmed provider that is hidden: Publish enabled in its menu, with no reason beside it", () => {
    const html = render([row({ lastConfirmed: "2026-09-30" })]);

    expect(html.match(/<button class="hub-button hub-button--secondary row-actions__item"[^>]*>Publish<\/button>/)?.[0]).not.toContain("disabled");
    expect(html).not.toContain("publish-hint");
    expect(html).toContain("Confirmed Sep 30, 2026");
  });

  it("keeps the code, categories and street as a small muted line under the name", () => {
    expect(render([row()])).toContain('<p class="provider-row__detail">M001 · Non-Profits · 45 Overlea Blvd</p>');
  });
});

describe("the providers list: Change opens the date field (a <details>, so it works without scripts)", () => {
  it("puts the date field, limited to today and required, and Save date inside the disclosure, after the badge's line", () => {
    const html = render([row({ lastConfirmed: "2026-09-30" })]);
    const edit = html.match(/<details class="provider-row__edit">[\s\S]*?<\/details>/)?.[0] ?? "";

    expect(edit.indexOf("<summary")).toBeLessThan(edit.indexOf("<form"));
    expect(edit).toMatch(/<label for="confirm-M001"[^>]*>Date last confirmed<\/label>/);
    const input = edit.match(/<input[^>]*id="confirm-M001"[^>]*>/)?.[0] ?? "";
    for (const attribute of ['name="date"', 'type="date"', 'max="2026-10-02"', 'required=""', 'value="2026-09-30"']) expect(input, attribute).toContain(attribute);
    expect(input).toMatch(/class="hub-input[ "]/);
    expect(edit.match(/<button[^>]*>Save date<\/button>/)?.[0]).toMatch(/class="hub-button hub-button--secondary[ "]/);
  });

  it("shows 'Today or earlier.' only with a refusal, so a row without one has no hint and no description on the field", () => {
    const html = render([row(), row({ id: "M002", lastConfirmed: "2026-09-30" })]);

    expect(html).not.toContain("Today or earlier.");
    expect(html).not.toContain("date-hint");
    expect(html.match(/<input[^>]*type="date"[^>]*>/g)?.join("")).not.toContain("aria-describedby");
  });

  it("the summary is the touch target, and its name says the state and the action", () => {
    const html = render([row({ lastConfirmed: "2026-09-30" })]);
    const summary = part(html, "provider-M001-change", "summary");

    expect(summary).toMatch(/^<summary class="provider-row__summary tap"/);
    // The rosette is decoration: its words are the name.
    expect(summary).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(summary.replace(/<[^>]+>/g, "")).toBe("Confirmed Sep 30, 2026Change");
  });
});

describe("the providers list: the rest of a row", () => {
  it("keeps an empty status region in every row, and no alert until something is refused", () => {
    const html = render([row()]);

    expect(html).toMatch(/<p id="provider-M001-message" role="status"[^>]*><\/p>/);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("hub-error");
  });

  it("shows a provider that left the catalogue with the pill 'Not in catalogue', its badge and date, and nothing to press", () => {
    const html = render([row({ inCatalogue: false, lastConfirmed: "2026-08-15" })]);

    expect(html).toMatch(/provider-pill--removed" data-testid="provider-M001-status">Not in catalogue</);
    expect(html).toMatch(/<p class="verified verified--yes" data-testid="provider-M001-confirmed"[^>]*>[\s\S]*Confirmed Aug 15, 2026/);
    expect(html).toContain(labels.removedNote);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<details");
  });

  it("has no field for listing text anywhere: only the provider's id and the date can be sent", () => {
    const html = render([row(), row({ id: "M002", published: true, lastConfirmed: "2026-09-30" })]);

    expect(html).not.toMatch(/<textarea/);
    expect(html).not.toMatch(/<input[^>]*type="text"/);
    const names = [...html.matchAll(/<input[^>]*name="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(names)).toEqual(new Set(["providerId", "date"]));
  });

  it("gives every provider its own ids, menu and live region", () => {
    const html = render([row(), row({ id: "M002" })]);

    for (const id of ["M001", "M002"]) {
      expect(html).toContain(`data-testid="provider-${id}"`);
      expect(html).toContain(`id="provider-${id}-message"`);
      expect(html).toContain(`data-testid="provider-${id}-actions"`);
      expect(html).toContain(`id="confirm-${id}"`);
    }
  });

  it("says why there is no row when the tabs or the search leave none", () => {
    const html = render([], "No providers match “zzz”.");

    expect(html).toContain('<p data-testid="provider-list-empty">No providers match “zzz”.</p>');
    expect(html).not.toContain('data-testid="provider-list"');
  });
});
