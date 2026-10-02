import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The component imports the server action; nothing of it runs while rendering to static markup.
vi.mock("./actions", () => ({ publishDirectoryAction: async () => ({ status: "idle" }) }));

import { englishText } from "@/i18n/text";
import { PublishDirectory } from "./PublishDirectory";

const labels = {
  publish: englishText("staff.directory.publish"),
  publishing: englishText("staff.directory.publishing"),
  publishHint: englishText("staff.directory.publishHint"),
};

describe("the Publish directory button (screen)", () => {
  const html = renderToStaticMarkup(<PublishDirectory labels={labels} />);

  it("is one primary Hub button named 'Publish directory', with its hint, in a form", () => {
    expect(html).toMatch(/<form[^>]*>/);
    const button = html.match(/<button[^>]*>Publish directory<\/button>/)?.[0] ?? "";
    expect(button).toContain('class="hub-button hub-button--primary"');
    expect(button).toContain('type="submit"');
    expect(button).not.toContain("disabled");
    expect(button).toContain('aria-describedby="publish-hint"');
    expect(html).toContain('id="publish-hint"');
  });

  it("always has its status region, empty until there is an answer, and no alert", () => {
    expect(html).toMatch(/<p role="status" data-testid="publish-message"><\/p>/);
    expect(html).not.toContain('role="alert"');
  });

  it("takes no text from the catalogue: the labels come from the page", () => {
    expect(html).not.toContain("staff.directory");
  });
});
