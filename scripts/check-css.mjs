// Checks behind docs/design-framework/spacing-container/token-architecture.md section 10, run on src/.
//
//   node scripts/check-css.mjs spacing   spacing from tokens only; no arbitrary spacing; no negative margins
//   node scripts/check-css.mjs layout    no 700px/800px layout literal; no Hub-only Grid props on resident routes
//   node scripts/check-css.mjs layers    semantic purity; primitives only in layer 2; one value per theme;
//                                        no undeclared custom property
//
// Each check prints its findings as file:line and exits non-zero when there are any.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postcss from "postcss";

export const SEMANTIC_FILE = "src/ui/tokens/semantic.css";
export const THEME_FILE = "src/ui/tokens/theme.generated.css";
const GENERATED = /\.generated\.css$/;
const SOURCE = /\.(css|ts|tsx|js|jsx|mjs)$/;
const SCRIPT = /\.(ts|tsx|js|jsx|mjs)$/;
// Unit tests describe CSS rather than use it, and ship nothing.
const TEST = /\.test\.[jt]sx?$/;

/** Every source file under root/src except unit tests, as { file, text } with file relative to root. */
export function readSources(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else if (SOURCE.test(entry.name) && !TEST.test(entry.name)) files.push({ file, text: readFileSync(path.join(root, file), "utf8") });
    }
  };
  walk("src");
  return files.sort((a, b) => a.file.localeCompare(b.file));
}

/** @typedef {{ file: string, line: number, message: string }} Finding */
/** @typedef {Finding & { reason: string }} Exception */

const isCss = ({ file }) => file.endsWith(".css");
/** @type {<T extends Finding>(findings: T[]) => T[]} */
const byPosition = (findings) => findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
const isScript = ({ file }) => SCRIPT.test(file);
const lineAt = (text, index) => text.slice(0, index).split("\n").length;
const parse = ({ file, text }) => postcss.parse(text, { from: file });

function declarationsOf(sources, filter = () => true) {
  const found = [];
  for (const source of sources.filter(isCss).filter(filter)) {
    parse(source).walkDecls((decl) => found.push({ file: source.file, decl, line: decl.source?.start?.line }));
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// Spacing from tokens only (proportionate). Checks padding*, margin*, gap, row-gap and column-gap;
// never border widths, sizes, positioning or line height.

const SPACING_PROPERTY = /^(?:padding|margin)(?:-[a-z-]+)?$|^(?:gap|row-gap|column-gap)$/;
const KEYWORD = /^(?:auto|normal|inherit|initial|unset|revert|revert-layer)$/i;
const LENGTH = /(?<![\w-])-?(?:\d+\.?\d*|\.\d+)(?:px|r?em|r?lh|ch|ex|ic|cap|%|[sdl]?v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max)|pt|pc|cm|mm|in|q)(?![\w-])/gi;
const ZERO = /^-?0*\.?0+[a-z%]*$/i;
const EXCEPTION = /\/\*\s*spacing-exception:\s*(\S[^*]*?)\s*\*\//;
// Environment variables that give a safe area, not a size the design chooses.
const SAFE_ENV = /^(?:safe-area-inset-(?:top|right|bottom|left)|titlebar-area-[\w-]+|keyboard-inset-[\w-]+)$/;

const SPACING_UTILITY =
  "(?:p|px|py|ps|pe|pt|pr|pb|pl|pbs|pbe|m|mx|my|ms|me|mt|mr|mb|ml|mbs|mbe|gap|gap-x|gap-y|space-x|space-y|scroll-p[xysetrbl]?|scroll-m[xysetrbl]?)";
// Arbitrary values and variable shorthands compile whatever the theme defines: p-[13px], gap-(--x).
const ARBITRARY_UTILITY = new RegExp(`(?<![\\w-])-?${SPACING_UTILITY}-(?:\\[[^\\]\\s]+\\]|\\([^)\\s]+\\))`, "g");
// The 1px utilities (p-px, gap-x-px, hub:ms-px): a literal length with a Tailwind name.
const PX_UTILITY = new RegExp(`(?<![\\w-])${SPACING_UTILITY}-px(?![\\w-])`, "g");
// Tailwind's shorthand for a variable (w-(--app-tap), leading-(--app-lh-body)) is use of a primitive.
const PRIMITIVE_SHORTHAND = /(?<![\w-])[a-z@][\w:@/.-]*-\(\s*(--app-[\w-]+)[^)]*\)/gi;
const ARBITRARY_PROPERTY = /(?<![\w-])\[(?:padding|margin|gap|row-gap|column-gap|scroll-padding|scroll-margin)[\w-]*:[^\]\s]+\]/g;
const NEGATIVE_UTILITY = /(?<![\w-])-(?:m|mx|my|ms|me|mt|mr|mb|ml|mbs|mbe|space-x|space-y)-[\w[\]().%/-]+/g;
// A spacing property of a style object: padding: 13, "margin-top": "-4px", rowGap: size. The key may be quoted
// and camelCase or kebab-case; the value a number, a string or an identifier (member access included).
const STYLE_OBJECT =
  /(?<![\w[$-])(["']?)((?:padding|margin|gap|row-gap|column-gap|rowGap|columnGap)(?:[A-Z]\w*|-[a-z-]+)?)\1\s*:\s*(-?\d*\.?\d+(?![\w.])|(["'`])[^"'`]*\4|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]\n]*\])*)/g;
// Not values: a type annotation (gap: number) and the words that stand for no value.
const NOT_A_VALUE = /^(?:number|string|boolean|never|unknown|any|undefined|null|void|true|false|[A-Z]\w*)$/;

const isNegative = (value) => {
  for (const match of value.matchAll(/(?:^|[\s(,])-(?=[\d.]|var\(|calc\()([\d.]*)/g)) {
    if (match[1] === "" || parseFloat(match[1]) !== 0) return true;
  }
  for (const match of value.matchAll(/\*\s*-\s*(\d*\.?\d+)|(\d*\.?\d+)\s*\*\s*-\s*(?!\d)|-\s*(\d*\.?\d+)\s*\*/g)) {
    if (parseFloat(match[1] ?? match[2] ?? match[3] ?? "1") !== 0) return true;
  }
  // calc(0px - var(--x)) is the negative of --x.
  return /calc\(\s*0*\.?0+[a-z%]*\s+-\s+/i.test(value);
};

const SINGLE_VAR_VALUE = /^var\(\s*(--[\w-]+)\s*\)$/;
// The tokens a spacing declaration may use (token-architecture.md section 10): the semantic spacing and
// size families, and component (layer 3) tokens that are a var() of an approved token.
const SPACING_FAMILY = /^--(?:gap|inset|gutter|offset)-|^--tap(?:-|$)/;

function approvedTokens(sources) {
  /** @type {Map<string, string[]>} */
  const values = new Map();
  for (const { decl } of declarationsOf(sources, (source) => !GENERATED.test(source.file))) {
    if (decl.prop.startsWith("--") && !decl.prop.startsWith("--app-")) values.set(decl.prop, [...(values.get(decl.prop) ?? []), decl.value.trim()]);
  }
  const approved = new Set();
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, list] of values) {
      if (approved.has(name)) continue;
      const references = list.map((value) => SINGLE_VAR_VALUE.exec(value)?.[1]);
      const ok = references.every((reference) =>
        reference !== undefined && (SPACING_FAMILY.test(name) ? reference.startsWith("--app-") || approved.has(reference) : approved.has(reference)),
      );
      if (ok) {
        approved.add(name);
        changed = true;
      }
    }
  }
  return approved;
}

/** The call at value[start] (a function name then "("), with its balanced end: { name, args, end }. */
function callAt(value, start) {
  const open = value.indexOf("(", start);
  let depth = 0;
  for (let index = open; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")" && --depth === 0) {
      return { name: value.slice(start, open), args: value.slice(open + 1, index), end: index + 1 };
    }
  }
  return { name: value.slice(start, open), args: value.slice(open + 1), end: value.length };
}

function spacingValueProblems(property, value, approved) {
  const problems = [];
  const negative = property.startsWith("margin") && isNegative(value);
  if (negative) problems.push(`negative margin "${property}: ${value}"`);
  // Replace each var() and env() by a space, checking its name and fallback.
  let rest = "";
  for (let index = 0; index < value.length; ) {
    const call = /^(?:var|env)\(/i.exec(value.slice(index));
    if (!call || /[\w-]/.test(value[index - 1] ?? " ")) {
      rest += value[index];
      index += 1;
      continue;
    }
    const { name, args, end } = callAt(value, index);
    const comma = args.indexOf(",");
    const reference = (comma < 0 ? args : args.slice(0, comma)).trim();
    const fallback = comma < 0 ? "" : args.slice(comma + 1).trim();
    if (name.toLowerCase() === "var") {
      if (reference.startsWith("--app-")) problems.push(`primitive ${reference} in "${property}"; use a semantic token`);
      else if (!approved.has(reference)) problems.push(`${reference} in "${property}" is not an approved spacing token`);
    } else if (!SAFE_ENV.test(reference)) {
      problems.push(`env(${reference}) in "${property}" is not a safe-area inset`);
    }
    const literal = [...fallback.matchAll(LENGTH)].map(([length]) => length).find((length) => !ZERO.test(length));
    if (literal) problems.push(`literal fallback ${literal} in ${name}(${args.trim()}) in "${property}"; use a spacing token`);
    rest += " ";
    index = end;
  }
  for (const [length] of rest.matchAll(LENGTH)) {
    if (!ZERO.test(length) && !(negative && length.startsWith("-"))) problems.push(`literal length ${length} in "${property}: ${value}"; use a spacing token`);
  }
  for (const word of rest.split(/[\s,()]+/).filter(Boolean)) {
    if (!KEYWORD.test(word) && !ZERO.test(word) && !/^(?:calc|min|max|clamp|[*/+-]|-?\d*\.?\d+[a-z%]*)$/i.test(word)) {
      problems.push(`"${word}" in "${property}" is not a spacing token`);
    }
  }
  return problems;
}

export function checkSpacing(sources) {
  const approved = approvedTokens(sources);
  /** @type {Finding[]} */
  const problems = [];
  /** @type {Exception[]} */
  const exceptions = [];
  const report = (file, text, line, message) => {
    const exception = EXCEPTION.exec(text.split("\n")[line - 1] ?? "");
    if (exception) exceptions.push({ file, line, message, reason: exception[1] });
    else problems.push({ file, line, message });
  };

  for (const source of sources.filter(isCss).filter((candidate) => !GENERATED.test(candidate.file))) {
    const root = parse(source);
    root.walkDecls(SPACING_PROPERTY, (decl) => {
      for (const message of spacingValueProblems(decl.prop, decl.value, approved)) {
        report(source.file, source.text, decl.source.start.line, message);
      }
    });
    root.walkAtRules("apply", (rule) => {
      for (const message of utilityProblems(rule.params)) report(source.file, source.text, rule.source.start.line, message);
    });
  }

  for (const source of sources.filter(isScript)) {
    for (const match of utilityMatches(source.text)) report(source.file, source.text, lineAt(source.text, match.index), match.message);
    for (const match of source.text.matchAll(STYLE_OBJECT)) {
      const [, , property, value, quote] = match;
      if (!quote && /^[A-Za-z_$]/.test(value) && NOT_A_VALUE.test(value)) continue;
      const css = property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      let messages;
      if (quote) messages = spacingValueProblems(css, value.slice(1, -1), approved);
      else if (/^[A-Za-z_$]/.test(value)) messages = [`"${value}" is not a literal in style "${property}"; use a spacing token or a spacing-exception`];
      else messages = Number(value) === 0 ? [] : isNegativeNumber(css, value) ? [`negative margin "${css}: ${value}px"`] : [`literal length ${value}px in style "${property}"`];
      for (const message of messages) report(source.file, source.text, lineAt(source.text, match.index), message);
    }
  }
  return { problems: byPosition(problems), exceptions: byPosition(exceptions) };
}

const isNegativeNumber = (property, value) => property.startsWith("margin") && value.startsWith("-");

// Every utility-class finding in a text, in order: { index, message }.
function utilityMatches(text) {
  const found = [];
  for (const pattern of [ARBITRARY_UTILITY, PX_UTILITY, ARBITRARY_PROPERTY, NEGATIVE_UTILITY, PRIMITIVE_SHORTHAND]) {
    for (const match of text.matchAll(pattern)) found.push({ index: match.index, message: utilityMessage(match[0], match[1]) });
  }
  return found.sort((a, b) => a.index - b.index);
}

// The patterns above are global (for matchAll); a global RegExp keeps lastIndex between test() calls, so
// this one is not.
const NEGATIVE_UTILITY_ONLY = new RegExp(`^${NEGATIVE_UTILITY.source}$`);

function utilityMessage(utility, primitive) {
  if (primitive) return `primitive ${primitive} via "${utility}"; use a semantic token (a primitive is never a utility value)`;
  if (NEGATIVE_UTILITY_ONLY.test(utility)) return `negative margin utility "${utility}"`;
  if (new RegExp(`^${PX_UTILITY.source}$`).test(utility)) return `1px spacing utility "${utility}"; use a token utility such as gap-icon or p-card`;
  return `arbitrary spacing class "${utility}"; use a token utility such as gap-icon or p-card`;
}

function utilityProblems(text) {
  return utilityMatches(text).map(({ message }) => message);
}

// ---------------------------------------------------------------------------------------------
// No layout literals: 700px and 800px exist only as the generated @theme's breakpoint and container.

// The shell breakpoint and the two-column container width, in any unit and any letter case: a length
// of 700 or 800 px, or its rem or em equivalent (16px to the rem, 43.75rem and 50em).
const LAYOUT_PX = [700, 800];
const LAYOUT_LENGTH = /(?<![\w.-])(\d*\.?\d+)(px|rem|em)(?![\w-])/gi;
const hasLayoutLiteral = (text) =>
  [...text.matchAll(LAYOUT_LENGTH)].some(([, amount, unit]) => {
    const px = parseFloat(amount) * (unit.toLowerCase() === "px" ? 1 : 16);
    return LAYOUT_PX.some((literal) => Math.abs(px - literal) < 1e-6);
  });
// A query written in text: @media / @container up to the end of its line or its block, wherever it
// appears (a CSS file, a string in code, an @custom-variant, an @apply with an arbitrary variant).
const QUERY_IN_TEXT = /@(?:media|container)\b[^{;\n]*/gi;
// min-[...] / max-[...] arbitrary variants, with or without the container @.
const ARBITRARY_VARIANT = /(?<![\w-])@?(?:min|max)-\[[^\]]*\]/gi;
// Size utilities that Tailwind makes from the two tokens (max-w-hub-two-column, max-w-screen-hub): each is a literal 700px or 800px.
const LITERAL_SIZE_UTILITY = /(?<![\w@-])[a-z][\w-]*-(?:hub-two-column|screen-hub)(?![\w-])/gi;
const RESIDENT_ROUTE = /^src\/app\/(?!staff\/)/;
const HUB_ONLY_PROP = /<Grid\b[^>]*\btwoColumn\s*=/g;

// Blanks CSS comments but keeps the line numbers.
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));

export function checkLayout(sources) {
  /** @type {Finding[]} */
  const problems = [];
  for (const source of sources) {
    if (source.file === THEME_FILE) continue;
    const text = isCss(source) ? stripComments(source.text) : source.text;
    const seen = new Set();
    const add = (line, literal, onlyIfNew = false) => {
      if (onlyIfNew ? [...seen].some((key) => key.startsWith(`${line}:`)) : seen.has(`${line}:${literal}`)) return;
      seen.add(`${line}:${literal}`);
      problems.push({ file: source.file, line, message: `layout literal in "${literal}"; use the hub: or @hub-two-column: variant` });
    };
    for (const pattern of [QUERY_IN_TEXT, ARBITRARY_VARIANT]) {
      for (const match of text.matchAll(pattern)) {
        if (hasLayoutLiteral(match[0])) add(lineAt(text, match.index), match[0].trim());
      }
    }
    if (isScript(source)) {
      for (const match of source.text.matchAll(LITERAL_SIZE_UTILITY)) {
        problems.push({
          file: source.file,
          line: lineAt(source.text, match.index),
          message: `"${match[0]}" compiles to a literal 700px or 800px; size layouts with the hub: or @hub-two-column: variants`,
        });
      }
    }
    if (isCss(source)) {
      // A query that spans lines, or is written some other way, is still an at-rule's parameters.
      parse({ file: source.file, text }).walkAtRules(/^(?:media|container|custom-variant|variant)$/i, (rule) => {
        if (hasLayoutLiteral(rule.params)) add(rule.source.start.line, `@${rule.name} ${rule.params}`, true);
      });
    }
    if (RESIDENT_ROUTE.test(source.file) && isScript(source)) {
      for (const match of source.text.matchAll(HUB_ONLY_PROP)) {
        problems.push({
          file: source.file,
          line: lineAt(source.text, match.index),
          message: "Grid twoColumn is for Hub pages only; resident routes may not use it",
        });
      }
    }
  }
  return { problems: byPosition(problems) };
}

// ---------------------------------------------------------------------------------------------
// Token layers: semantic purity, no primitives outside layer 2, one value per theme, no undeclared
// custom property.

const SINGLE_VAR = /^var\(--[\w-]+\)$/;
const PRIMITIVE_REFERENCE = /var\(\s*(--app-[\w-]*)|(?<![\w-])[a-z@][\w:@/.-]*-\(\s*(--app-[\w-]*)/gi;
const THEME_INVARIANT = /^--(?:app-|radius-|gap-|inset-|gutter-|offset-|size-|tap)/;
const VAR_REFERENCE = /var\(\s*--([\w-]+)/g;

export function checkLayers(sources) {
  /** @type {Finding[]} */
  const problems = [];
  const layerFiles = (source) => !GENERATED.test(source.file);

  for (const { file, decl, line } of declarationsOf(sources, layerFiles)) {
    if (decl.prop.startsWith("--") && !SINGLE_VAR.test(decl.value.trim())) {
      problems.push({ file, line, message: `${decl.prop}: ${decl.value} is not a single var(); token layers 2 and 3 hold no values` });
    }
  }

  for (const source of sources.filter((candidate) => candidate.file !== SEMANTIC_FILE && !GENERATED.test(candidate.file))) {
    for (const match of source.text.matchAll(PRIMITIVE_REFERENCE)) {
      problems.push({
        file: source.file,
        line: lineAt(source.text, match.index),
        message: `references the --app-* primitive ${match[1] ?? match[2]}; only semantic.css may (use a semantic token)`,
      });
    }
  }

  for (const source of sources.filter(isCss)) {
    parse(source).walkRules(/\[data-theme/, (rule) => {
      rule.walkDecls(THEME_INVARIANT, (decl) => {
        problems.push({
          file: source.file,
          line: decl.source.start.line,
          message: `${decl.prop} inside "${rule.selector}": spacing, size and radius have one value in every theme`,
        });
      });
    });
  }

  // Tailwind theme variables (--color-ink) exist only inside the generated @theme reference block, which
  // emits no custom properties, so that file declares nothing for var().
  const declared = new Set(
    declarationsOf(sources, (source) => source.file !== THEME_FILE)
      .map(({ decl }) => decl.prop.slice(2))
      .filter(Boolean),
  );
  for (const source of sources) {
    for (const match of source.text.matchAll(VAR_REFERENCE)) {
      if (!declared.has(match[1])) {
        problems.push({
          file: source.file,
          line: lineAt(source.text, match.index),
          message: `var(--${match[1]}) is not declared in the generated, semantic or component token files`,
        });
      }
    }
  }
  return { problems: byPosition(problems) };
}

// ---------------------------------------------------------------------------------------------

export const CHECKS = {
  spacing: { title: "Spacing check", run: checkSpacing },
  layout: { title: "Layout literal check", run: checkLayout },
  layers: { title: "Token layer check", run: checkLayers },
};

/** @returns {{ code: number, output: string }} */
export function runCheck(name, root) {
  const check = CHECKS[name];
  if (!check) return { code: 2, output: `Unknown check "${name}"; expected one of ${Object.keys(CHECKS).join(", ")}` };
  const { problems, exceptions = [] } = check.run(readSources(root));
  const lines = [];
  if (problems.length > 0) {
    lines.push(`${check.title} failed: ${problems.length} problem(s)`);
    for (const { file, line, message } of problems) lines.push(`  ${file}:${line}: ${message}`);
  } else {
    lines.push(`${check.title} passed.`);
  }
  if (exceptions.length > 0) {
    lines.push(`Reviewed spacing exceptions (${exceptions.length}):`);
    for (const { file, line, message, reason } of exceptions) lines.push(`  ${file}:${line}: ${message} (reason: ${reason})`);
  }
  return { code: problems.length > 0 ? 1 : 0, output: lines.join("\n") };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [name, root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")] = process.argv.slice(2);
  const { code, output } = runCheck(name, path.resolve(root));
  (code === 0 ? console.log : console.error)(output);
  process.exitCode = code;
}
