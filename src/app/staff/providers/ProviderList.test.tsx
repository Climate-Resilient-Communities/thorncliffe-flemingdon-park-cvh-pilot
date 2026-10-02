import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The list imports the server actions; nothing of them runs while rendering to static markup.
vi.mock("./actions", () => ({ confirmProviderAction: async () => ({ status: "idle" }), publishProviderAction: async () => ({ status: "idle" }), unpublishProviderAction: async () => ({ status: "idle" }) }));

import { englishText } from "@/i18n/text";
import { ProviderList, type ProviderListLabels, type ProviderRowData } from "./ProviderList";

const labels: ProviderListLabels = {
  statusPublished: englishText("staff.providers.statusPublished"),
  statusUnpublished: englishText("staff.providers.statusUnpublished"),
  statusRemoved: englishText("staff.providers.statusRemoved"),
  removedNote: englishText("staff.providers.removedNote"),
  neverConfirmed: englishText("staff.providers.neverConfirmed"),
  confirmDate: englishText("staff.providers.confirmDate"),
  confirmedOn: englishText("staff.providers.confirmedOn", { date: "{date}" }),
  dateHint: englishText("staff.providers.dateHint"),
  saveDate: englishText("staff.providers.saveDate"),
  publish: englishText("staff.providers.publish"),
  unpublish: englishText("staff.providers.unpublish"),
};

const row = (change: Partial<ProviderRowData> = {}): ProviderRowData => ({
  id: "M001",
  name: "Thorncliffe Neighbourhood Office",
  detail: "M001 · Non-Profits · 45 Overlea Blvd",
  published: false,
  inCatalogue: true,
  lastConfirmed: null,
  ...change,
});

const render = (rows: ProviderRowData[]) => renderToStaticMarkup(<ProviderList rows={rows} today="2026-10-02" labels={labels} />);

describe("the providers list (screen)", () => {
  it("shows a provider that is not confirmed: its status in words, no date yet, a required date field limited to today, and Publish", () => {
    const html = render([row()]);

    expect(html).toContain("Thorncliffe Neighbourhood Office");
    expect(html).toContain("Not published");
    expect(html).toContain("Not confirmed yet");
    expect(html).toMatch(/<label for="confirm-M001">Last confirmed on<\/label>/);
    const input = html.match(/<input[^>]*id="confirm-M001"[^>]*>/)?.[0] ?? "";
    for (const attribute of ['name="date"', 'type="date"', 'max="2026-10-02"', 'required=""']) expect(input, attribute).toContain(attribute);
    expect(html).toContain(">Save date</button>");
    expect(html).toContain(">Publish</button>");
    expect(html).not.toContain("Unpublish");
  });

  it("shows a published, confirmed provider with its date and Unpublish", () => {
    const html = render([row({ published: true, lastConfirmed: "2026-09-30" })]);

    expect(html).toContain(">Published</strong>");
    expect(html).toContain("Last confirmed 2026-09-30");
    expect(html).toMatch(/value="2026-09-30"/);
    expect(html).toContain(">Unpublish</button>");
  });

  it("shows a provider that left the catalogue as 'Not in catalogue', with its date and no buttons", () => {
    const html = render([row({ inCatalogue: false, lastConfirmed: "2026-09-30" })]);

    expect(html).toContain("Not in catalogue");
    expect(html).toContain("Last confirmed 2026-09-30");
    expect(html).toContain(labels.removedNote);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
  });

  it("has no field for listing text anywhere: only the provider's id and the date can be sent", () => {
    const html = render([row(), row({ id: "M002", published: true, lastConfirmed: "2026-09-30" })]);

    expect(html).not.toMatch(/<textarea/);
    expect(html).not.toMatch(/<input[^>]*type="text"/);
    const names = [...html.matchAll(/<input[^>]*name="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(names)).toEqual(new Set(["providerId", "date"]));
  });

  it("gives every provider its own ids and a live region for its answer", () => {
    const html = render([row(), row({ id: "M002" })]);

    expect(html).toContain('data-testid="provider-M001"');
    expect(html).toContain('data-testid="provider-M002"');
    expect(html).toContain('id="provider-M001-message"');
    expect(html).toContain('id="provider-M002-message"');
  });
});
