import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StaffSignInView } from "./StaffSignInView";

describe("staff entry and account help", () => {
  it("keeps recovery guidance public without promising an unsupported email reset", () => {
    const html = renderToStaticMarkup(<StaffSignInView />);
    expect(html).toContain('src="/brand/hub-logo.png"');
    expect(html).toContain('href="/en"');
    expect(html).toContain("Forgot your password?");
    expect(html).toContain("does not send automatic password-reset emails");
    expect(html).toContain("within 72 hours");
    expect(html).toContain("Admins and Coordinators");
    expect(html).toContain('autoComplete="current-password"');
    expect(html).not.toContain('href="/staff/register"');
    expect(html.indexOf('id="username"')).toBeLessThan(html.indexOf('id="new-staff-title"'));
  });
});
