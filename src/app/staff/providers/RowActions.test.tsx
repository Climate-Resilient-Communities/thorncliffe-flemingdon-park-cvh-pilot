import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RowActions } from "./RowActions";

// Opening, Escape, a press outside and the return of focus are browser behaviour: e2e/layout/providers.spec.ts presses the keys.
describe("a row's actions menu", () => {
  const html = renderToStaticMarkup(
    <RowActions label="Actions for East York Food Bank" testId="menu">
      <button type="submit">Unpublish</button>
    </RowActions>,
  );

  it("is a closed disclosure whose button is the summary, named for its row, at least a touch target", () => {
    expect(html).toMatch(/^<details class="row-actions" data-testid="menu">/);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).toContain('<summary class="row-actions__button tap" aria-label="Actions for East York Food Bank">');
  });

  it("shows ⋯ but does not read it out", () => {
    expect(html).toContain('<span aria-hidden="true">⋯</span>');
  });

  it("holds its items after the button, in the order given", () => {
    expect(html.indexOf("</summary>")).toBeLessThan(html.indexOf("Unpublish"));
    expect(html).toContain('<div class="row-actions__panel"><button type="submit">Unpublish</button></div>');
  });
});
