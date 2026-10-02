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
const KEYWORD = /^(?:auto|inherit|initial|unset|revert|revert-layer)$/;
const LENGTH = /(?<![\w-])-?(?:\d+\.?\d*|\.\d+)(?:px|r?em|r?lh|ch|ex|ic|cap|%|[sdl]?v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max)|pt|pc|cm|mm|in|q)(?![\w-])/gi;
const ZERO = /^-?0*\.?0+[a-z%]*$/i;
const NEGATIVE = /(?:^|[\s(,])-(?:\d|\.\d|var\(|calc\()|\*\s*-\s*\d|-\s*\d+(?:\.\d+)?\s*\*/;
const EXCEPTION = /\/\*\s*spacing-exception:\s*(\S[^*]*?)\s*\*\//;

const SPACING_UTILITY =
  "(?:p|px|py|ps|pe|pt|pr|pb|pl|pbs|pbe|m|mx|my|ms|me|mt|mr|mb|ml|mbs|mbe|gap|gap-x|gap-y|space-x|space-y|scroll-p[xysetrbl]?|scroll-m[xysetrbl]?)";
// Arbitrary values and variable shorthands compile whatever the theme defines: p-[13px], gap-(--x).
const ARBITRARY_UTILITY = new RegExp(`(?<![\\w-])-?${SPACING_UTILITY}-(?:\\[[^\\]\\s]+\\]|\\([^)\\s]+\\))`, "g");
const ARBITRARY_PROPERTY = /(?<![\w-])\[(?:padding|margin|gap|row-gap|column-gap|scroll-padding|scroll-margin)[\w-]*:[^\]\s]+\]/g;
const NEGATIVE_UTILITY = /(?<![\w-])-(?:m|mx|my|ms|me|mt|mr|mb|ml|mbs|mbe|space-x|space-y)-[\w[\]().%/-]+/g;
const STYLE_OBJECT = /(?<![\w[-])(?:padding|margin|gap|rowGap|columnGap)(?:[A-Z]\w*)?\s*:\s*(-?\d*\.?\d+|(["'`])[^"'`]*\2)/g;

/** Custom properties a spacing declaration may use: semantic tokens and component tokens. */
function approvedTokens(sources) {
  const names = new Set();
  for (const { decl } of declarationsOf(sources, (source) => !GENERATED.test(source.file))) {
    if (decl.prop.startsWith("--") && !decl.prop.startsWith("--app-")) names.add(decl.prop);
  }
  return names;
}

function spacingValueProblems(property, value, approved) {
  const problems = [];
  const negative = property.startsWith("margin") && NEGATIVE.test(value);
  if (negative) problems.push(`negative margin "${property}: ${value}"`);
  const withoutVars = value.replace(/var\(\s*(--[\w-]+)[^)]*\)/g, (_match, name) => {
    if (name.startsWith("--app-")) problems.push(`primitive ${name} in "${property}"; use a semantic token`);
    else if (!approved.has(name)) problems.push(`${name} in "${property}" is not an approved spacing token`);
    return " ";
  });
  for (const [length] of withoutVars.matchAll(LENGTH)) {
    if (!ZERO.test(length) && !(negative && length.startsWith("-"))) problems.push(`literal length ${length} in "${property}: ${value}"; use a spacing token`);
  }
  for (const word of withoutVars.split(/[\s,()]+/).filter(Boolean)) {
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
    for (const pattern of [ARBITRARY_UTILITY, ARBITRARY_PROPERTY, NEGATIVE_UTILITY]) {
      for (const match of source.text.matchAll(pattern)) {
        report(source.file, source.text, lineAt(source.text, match.index), utilityMessage(match[0]));
      }
    }
    for (const match of source.text.matchAll(STYLE_OBJECT)) {
      const value = match[2] ? match[1].slice(1, -1) : match[1];
      const property = match[0].split(":")[0].trim();
      const css = property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      const literal = match[2] ? spacingValueProblems(css, value, approved) : Number(value) === 0 ? [] : [`literal length ${value}px in style "${property}"`];
      for (const message of literal) report(source.file, source.text, lineAt(source.text, match.index), message);
    }
  }
  return { problems: byPosition(problems), exceptions: byPosition(exceptions) };
}

function utilityMessage(utility) {
  return utility.startsWith("-") && NEGATIVE_UTILITY.test(utility)
    ? `negative margin utility "${utility}"`
    : `arbitrary spacing class "${utility}"; use a token utility such as gap-icon or p-card`;
}

function utilityProblems(text) {
  return [ARBITRARY_UTILITY, ARBITRARY_PROPERTY, NEGATIVE_UTILITY].flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => utilityMessage(match[0])),
  );
}

// ---------------------------------------------------------------------------------------------
// No layout literals: 700px and 800px exist only as the generated @theme's breakpoint and container.

const LAYOUT_LITERAL = /(?<![\d.])[78]00px\b/;
const QUERY_IN_TEXT = /@(?:media|container)\b[^{;]*?(?<![\d.])[78]00px/g;
const ARBITRARY_VARIANT = /(?<![\w-])@?(?:min|max)-\[[^\]]*?(?<![\d.])[78]00px\]/g;
const RESIDENT_ROUTE = /^src\/app\/(?!staff\/)/;
const HUB_ONLY_PROP = /<Grid\b[^>]*\btwoColumn\s*=/g;

export function checkLayout(sources) {
  /** @type {Finding[]} */
  const problems = [];
  for (const source of sources) {
    if (source.file === THEME_FILE) continue;
    if (isCss(source)) {
      parse(source).walkAtRules(/^(?:media|container)$/, (rule) => {
        if (LAYOUT_LITERAL.test(rule.params)) {
          problems.push({
            file: source.file,
            line: rule.source.start.line,
            message: `layout literal in "@${rule.name} ${rule.params}"; use the hub: or @hub-two-column: variant`,
          });
        }
      });
    }
    for (const pattern of isCss(source) ? [ARBITRARY_VARIANT] : [QUERY_IN_TEXT, ARBITRARY_VARIANT]) {
      for (const match of source.text.matchAll(pattern)) {
        problems.push({
          file: source.file,
          line: lineAt(source.text, match.index),
          message: `layout literal in "${match[0]}"; use the hub: or @hub-two-column: variant`,
        });
      }
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
const PRIMITIVE_REFERENCE = /var\(\s*--app-/g;
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
        message: "references an --app-* primitive; only semantic.css may (use a semantic token)",
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

  const declared = new Set(declarationsOf(sources).map(({ decl }) => decl.prop.slice(2)).filter(Boolean));
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
