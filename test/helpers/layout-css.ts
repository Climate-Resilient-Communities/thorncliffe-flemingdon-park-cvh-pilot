import { readFileSync } from "node:fs";
import path from "node:path";
import postcss, { type AtRule, type Container } from "postcss";

export type Declaration = { selector: string; at: string[]; prop: string; value: string };

const PHYSICAL = /^(?:left|right|top|bottom|float|clear|(?:margin|padding|border|scroll-margin|scroll-padding)-(?:left|right|top|bottom)(?:-.*)?|border-(?:top|bottom)-(?:left|right)-radius)$/;
const PHYSICAL_VALUE = /^(?:text-align|float|clear|caption-side)$/;

/** Every declaration in a src/ui stylesheet, with its (nested) selector and enclosing at-rules. */
export function layoutDeclarations(file: string): Declaration[] {
  const css = readFileSync(path.join(__dirname, "..", "..", file), "utf8");
  const found: Declaration[] = [];
  postcss.parse(css).walkDecls((decl) => {
    const selectors: string[] = [];
    const at: string[] = [];
    for (let node: Container | undefined = decl.parent; node && node.type !== "root"; node = node.parent as Container) {
      if (node.type === "rule") selectors.unshift((node as postcss.Rule).selector);
      else if (node.type === "atrule" && (node as AtRule).name !== "layer") at.unshift(`@${(node as AtRule).name} ${(node as AtRule).params}`);
    }
    found.push({ selector: selectors.join(" "), at, prop: decl.prop, value: decl.value });
  });
  return found;
}

/** Physical properties and values, and 3- or 4-value margin/padding shorthands (RTL rules, token-architecture.md section 6). */
export function physicalDeclarations(declarations: Declaration[]) {
  return declarations.filter(
    ({ prop, value }) =>
      PHYSICAL.test(prop) ||
      (PHYSICAL_VALUE.test(prop) && /\b(?:left|right)\b/.test(value)) ||
      (/^(?:margin|padding)$/.test(prop) && value.trim().split(/\s+(?![^(]*\))/).length > 2),
  );
}

/** Lengths other than 0 written as literals (fr, percentages and unitless numbers are not lengths). */
export function literalLengths(declarations: Declaration[]) {
  return declarations.filter(({ value }) =>
    [...value.replace(/var\([^)]*\)/g, "").matchAll(/-?(?:\d*\.)?\d+([a-z%]+)/gi)].some(([length, unit]) => unit !== "fr" && unit !== "%" && !/^-?0*\.?0+[a-z%]*$/i.test(length)),
  );
}

/** The shell breakpoint and two-column container width from tokens.json, as a pattern for their literals. */
export function layoutLiterals() {
  const tokens = JSON.parse(readSource("design/prototype/ds/cvrh/tokens.json"));
  const values = [tokens.breakpoint.tokens, tokens.container.tokens].flat().map((token: { value: string }) => parseFloat(token.value));
  return new RegExp(`(?<![\\d.])(?:${values.join("|")})(?!\\d)`);
}

export function readSource(file: string) {
  return readFileSync(path.join(__dirname, "..", "..", file), "utf8");
}
