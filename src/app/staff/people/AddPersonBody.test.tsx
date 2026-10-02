import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AddPersonBody, addPersonLabels } from "./AddPersonBody";
import { AddPersonForm } from "./AddPersonForm";

describe("Add a person (screen)", () => {
  it("offers every role after bootstrap, with a labelled field for each detail", () => {
    const html = renderToStaticMarkup(
      <AddPersonBody view={{ allowed: true, roles: ["ambassador", "coordinator", "director", "admin"], bootstrap: "completed" }} />,
    );

    for (const [id, label] of [
      ["username", "Username"],
      ["firstName", "First name"],
      ["lastName", "Last name"],
      ["email", "Email"],
      ["role", "Role"],
    ]) {
      expect(html).toContain(`<label for="${id}">${label}</label>`);
      expect(html).toMatch(new RegExp(`id="${id}"`));
    }
    expect(html.match(/<option /g)).toHaveLength(4);
    expect(html).toContain(">Add person</button>");
    expect(html).not.toContain("Setup is not finished");
  });

  it("offers only the Admin role during bootstrap, and says why", () => {
    const html = renderToStaticMarkup(<AddPersonBody view={{ allowed: true, roles: ["admin"], bootstrap: "in_progress" }} />);

    expect(html.match(/<option /g)).toHaveLength(1);
    expect(html).toContain('<option value="admin" selected="">Admin</option>');
    expect(html).toContain("Setup is not finished. You can add one more Admin now.");
  });

  it("shows the refusal instead of the form when the person may not add anyone", () => {
    expect(renderToStaticMarkup(<AddPersonBody view={{ allowed: false, refusal: "bootstrap_incomplete" }} />)).toBe(
      '<p role="alert">Finish setting up two Admins first</p>',
    );
    expect(renderToStaticMarkup(<AddPersonBody view={{ allowed: false, refusal: "forbidden" }} />)).toBe(
      '<p role="alert">Only an Admin can add people.</p>',
    );
  });

  it("keeps the entered values after a refusal, marks the field and links it to the message", () => {
    const html = renderToStaticMarkup(
      <AddPersonForm
        labels={addPersonLabels()}
        roles={[{ value: "admin", label: "Admin" }]}
        initialState={{ status: "refused", message: "That username is already taken. Choose another.", field: "username", values: { username: "jdoe", firstName: "Jane" } }}
      />,
    );

    expect(html).toContain('<p id="add-person-error" role="alert">That username is already taken. Choose another.</p>');
    expect(html).toMatch(/aria-describedby="username-hint add-person-error" aria-invalid="true" name="username" value="jdoe"/);
    expect(html).toMatch(/id="firstName"[^>]*value="Jane"/);
  });

  it("shows the username and starting password to hand over, and sends nothing", () => {
    const html = renderToStaticMarkup(
      <AddPersonForm
        labels={addPersonLabels()}
        roles={[]}
        initialState={{ status: "created", heading: "Account created for Omar Farouk", username: "Username: ofarouk", password: "Starting password: rvh-omar-farouk", line: "Give them these in person." }}
      />,
    );

    expect(html).toContain("<h2>Account created for Omar Farouk</h2>");
    expect(html).toContain("<p>Starting password: rvh-omar-farouk</p>");
    expect(html).toContain('href="/staff/people">Add another person</a>');
  });
});
