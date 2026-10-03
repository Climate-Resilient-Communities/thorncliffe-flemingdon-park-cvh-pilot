import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// A bare <input>, <select>, <textarea> or <button> is drawn by the browser as plain text on the Hub's page surface (see
// src/ui/hub/hub-forms.css), which is how the staff sign-in once shipped with invisible boxes. Every control in a staff
// screen therefore carries its Hub class: hub-input, hub-button with a variant, or a checkbox / radio inside a
// hub-choice / hub-check label. This reads the staff screens' markup (src/app/staff/**/*.tsx) and fails on a bare one.
const STAFF = __dirname;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [full] : [];
  });
}

interface Tag {
  name: string;
  attributes: string;
  /** The text before the tag, for the label it sits in. */
  before: string;
  line: number;
}

/** Every opening <input>, <select>, <textarea>, <button> and <label> tag, reading past `>` inside {...} and quotes. */
function tags(source: string): Tag[] {
  const found: Tag[] = [];
  const open = /<(input|select|textarea|button|label)(?=[\s/>])/g;
  for (let match = open.exec(source); match; match = open.exec(source)) {
    let depth = 0;
    let quote = "";
    let end = open.lastIndex;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (quote) {
        if (char === quote) quote = "";
      } else if (depth === 0 && (char === '"' || char === "'")) quote = char;
      else if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0) break;
    }
    found.push({
      name: match[1],
      attributes: source.slice(open.lastIndex, end),
      before: source.slice(0, match.index),
      line: source.slice(0, match.index).split("\n").length,
    });
  }
  return found;
}

const classOf = (attributes: string) => /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/.exec(attributes)?.slice(1).find(Boolean) ?? "";
const typeOf = (attributes: string) => /\btype=(?:"([^"]*)"|\{"([^"]*)"\})/.exec(attributes)?.slice(1).find(Boolean);

/** The classes of the nearest <label> opened before this control and not yet closed. */
function enclosingLabelClass(tag: Tag, all: Tag[]): string {
  const labels = all.filter((other) => other.name === "label" && other.line <= tag.line && other.before.length < tag.before.length);
  const nearest = labels.at(-1);
  if (!nearest) return "";
  const between = tag.before.slice(nearest.before.length);
  return /<\/label>/.test(between) ? "" : classOf(nearest.attributes);
}

function problems(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const all = tags(source);
  const out: string[] = [];
  const where = (tag: Tag) => `${path.relative(STAFF, file)}:${tag.line} <${tag.name}>`;
  for (const tag of all) {
    const classes = classOf(tag.attributes).split(/\s+/);
    if (tag.name === "label") continue;
    if (tag.name === "button") {
      if (!classes.includes("hub-button")) out.push(`${where(tag)} lacks hub-button`);
      else if (!/hub-button--(primary|secondary)/.test(classOf(tag.attributes))) out.push(`${where(tag)} has no hub-button variant (--primary or --secondary)`);
      continue;
    }
    if (tag.name === "input") {
      const type = typeOf(tag.attributes);
      if (type === "hidden") continue;
      if (type === "checkbox" || type === "radio") {
        const label = enclosingLabelClass(tag, all).split(/\s+/);
        if (!label.includes("hub-choice") && !label.includes("hub-check")) out.push(`${where(tag)} (${type}) is not inside a hub-choice or hub-check label`);
        continue;
      }
    }
    if (!classes.includes("hub-input")) out.push(`${where(tag)} lacks hub-input`);
  }
  return out;
}

describe("the staff screens' controls carry their Hub classes", () => {
  const sources = files(STAFF);

  it("finds the staff screens' forms", () => {
    expect(sources.length).toBeGreaterThan(10);
    const names = sources.map((file) => path.relative(STAFF, file));
    for (const expected of ["sign-in/SignInForm.tsx", "people/AddPersonForm.tsx", "buildings/FloorForms.tsx"]) expect(names).toContain(expected);
  });

  it("has no bare input, select, textarea or button", () => {
    expect(sources.flatMap(problems)).toEqual([]);
  });

  it("styles a refusal as text, not as a plain paragraph", () => {
    const bare = sources.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) => (/<p\b[^>]*role="alert"/.test(line) && !/hub-error/.test(line) && !/(Question|question)/.test(line) ? [`${path.relative(STAFF, file)}:${index + 1}`] : [])),
    );
    expect(bare).toEqual([]);
  });

  it("reads a tag whose attributes hold > (the scanner itself)", () => {
    const [bare, classed] = tags('<input type="text" onChange={() => go()} /><input className="hub-input" onChange={(e) => a > b} />');
    expect(classOf(bare.attributes)).toBe("");
    expect(classOf(classed.attributes)).toBe("hub-input");
    const labelled = tags('<label className="hub-choice"><input type="radio" /></label><input type="radio" />');
    expect(enclosingLabelClass(labelled[1], labelled)).toBe("hub-choice");
    expect(enclosingLabelClass(labelled[2], labelled)).toBe("");
  });
});
