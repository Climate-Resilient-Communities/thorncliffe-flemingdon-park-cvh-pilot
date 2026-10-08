import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProviderFilters } from "./ProviderFilters";
import { providerFiltersLabels } from "./labels";

const render = (filter: "all" | "confirm" | "hidden", q = "") =>
  renderToStaticMarkup(<ProviderFilters query={{ filter, q }} counts={{ all: 99, confirm: 0, hidden: 2 }} labels={providerFiltersLabels()} />);

describe("the Providers filter tabs", () => {
  it("are links with their counts, 'All 99 · To confirm 0 · Hidden 2', in a named navigation", () => {
    const html = render("all");

    expect(html).toContain('<nav aria-label="Filter providers">');
    const text = [...html.matchAll(/<a class="provider-tab tap"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
    expect(text).toEqual(["All 99", "To confirm 0", "Hidden 2"]);
    expect(html).toContain('href="/staff/providers"');
    expect(html).toContain('href="/staff/providers?filter=confirm"');
    expect(html).toContain('href="/staff/providers?filter=hidden"');
  });

  it("mark the current one with aria-current, and only it", () => {
    const html = render("hidden");

    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/href="\/staff\/providers\?filter=hidden" aria-current="page"/);
  });

  it("keep the search in their links", () => {
    expect(render("all", "food")).toContain('href="/staff/providers?filter=confirm&amp;q=food"');
  });
});

describe("the Providers search", () => {
  it("is a GET form of the page, labelled, so it works without scripts", () => {
    const html = render("all");

    const form = html.match(/<form[^>]*>/)?.[0] ?? "";
    for (const attribute of ['class="provider-search"', 'method="get"', 'action="/staff/providers"', 'role="search"']) expect(form, attribute).toContain(attribute);
    expect(html).toMatch(/<label for="provider-search"[^>]*>Search by name or code<\/label>/);
    const input = html.match(/<input[^>]*id="provider-search"[^>]*>/)?.[0] ?? "";
    for (const attribute of ['class="hub-input provider-search__input"', 'name="q"', 'type="search"']) expect(input, attribute).toContain(attribute);
    expect(html).toContain(">Search</button>");
    expect(html).not.toContain('name="filter"');
    expect(html).not.toContain("Clear search");
  });

  it("keeps the tab and the words searched, and offers to clear them", () => {
    const html = render("confirm", "food");

    expect(html).toContain('<input type="hidden" name="filter" value="confirm"/>');
    expect(html.match(/<input[^>]*id="provider-search"[^>]*>/)?.[0]).toContain('value="food"');
    expect(html).toMatch(/<a class="hub-link tap" href="\/staff\/providers\?filter=confirm" data-testid="provider-search-clear">Clear search<\/a>/);
  });
});
