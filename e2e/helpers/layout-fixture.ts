import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import type { ComponentProps } from "react";
import type * as Fixtures from "../layout/fixtures";
import { compileCss } from "../../test/helpers/compile-css";

// Layout fixtures are rendered to static HTML with react-dom/server and loaded with page.setContent
// together with the app's compiled stylesheet, so the tests need no server and add no route to the app.
const ROOT = path.join(__dirname, "..", "..");
const RTL = new Set(["ur", "ps", "prs"]);

type Render = (name: string, props: unknown) => string;

// The providers list and the Publish directory button import their server actions, which reach the database; the harness
// renders them without a server, so those imports are answered by e2e/helpers/provider-actions-stub.ts and
// e2e/helpers/directory-actions-stub.ts (a refusal and a done message to photograph).
const STUBS: { importer: RegExp; stub: string }[] = [
  { importer: /providers[\\/]ProviderList\.tsx$/, stub: "provider-actions-stub.ts" },
  { importer: /directory[\\/]PublishDirectory\.tsx$/, stub: "directory-actions-stub.ts" },
];
const providerActionsStub: Plugin = {
  name: "server-actions-stub",
  setup(build) {
    build.onResolve({ filter: /^\.\/actions$/ }, (args) => {
      const match = STUBS.find(({ importer }) => importer.test(args.importer));
      return match ? { path: path.join(ROOT, "e2e", "helpers", match.stub) } : undefined;
    });
  },
};

let stylesheet: Promise<string> | undefined;
let renderer: Promise<Render> | undefined;

// page.setContent has no base URL, so a font file cannot be fetched by path: the staff layout's own stylesheet
// (src/app/staff/fonts.generated.css, Public Sans Latin and Latin-extended) is inlined with each file as a data URI.
// The harness therefore sets its text in the face the staff screens load, not in a system fallback.
const STAFF_FONTS_CSS = path.join(ROOT, "src", "app", "staff", "fonts.generated.css");
let fonts: string | undefined;

function fontCss(): string {
  return (fonts ??= readFileSync(STAFF_FONTS_CSS, "utf8").replace(/url\(([^)]+\.woff2)\)/g, (_, file: string) => {
    const data = readFileSync(path.resolve(path.dirname(STAFF_FONTS_CSS), file)).toString("base64");
    return `url(data:font/woff2;base64,${data})`;
  }));
}

/** Waits for Public Sans to load and fails unless it is really the face in use, not a system fallback. */
async function expectPublicSansLoaded(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.load('16px "Public Sans"', "Aa");
    await document.fonts.ready;
  });
  // check() is also true when no such face is declared at all, so the loaded face itself is asserted as well.
  expect(await page.evaluate(() => document.fonts.check('16px "Public Sans"')), "Public Sans is available").toBe(true);
  expect(
    await page.evaluate(() => [...document.fonts].filter((face) => face.family.replaceAll(/["']/g, "") === "Public Sans" && face.status === "loaded").length),
    "a Public Sans face is loaded",
  ).toBeGreaterThan(0);
}

const appCss = () => (stylesheet ??= compileCss(path.join(ROOT, "e2e", "layout", "app.css"), { optimize: true }));

// Playwright compiles JSX for component testing, so the fixtures (and the primitives they use) are
// bundled with esbuild into plain React code instead.
async function loadRenderer(): Promise<Render> {
  const result = await build({
    stdin: {
      contents: `
        import { createElement } from "react";
        import { renderToStaticMarkup } from "react-dom/server";
        import * as fixtures from "./e2e/layout/fixtures";
        export const render = (name, props) => renderToStaticMarkup(createElement(fixtures[name], props));
      `,
      resolveDir: ROOT,
      loader: "tsx",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    tsconfig: path.join(ROOT, "tsconfig.json"),
    plugins: [providerActionsStub],
    external: ["react", "react-dom"],
    write: false,
    logLevel: "silent",
  });
  const bundle = { exports: {} as { render: Render } };
  new Function("require", "module", "exports", result.outputFiles[0].text)(require, bundle, bundle.exports);
  return bundle.exports.render;
}

// The same fixtures with their client code running: bundled for the browser, hydrated over the server
// markup. Only effects (such as ScreenActions') need it; everything else uses the static `mount`.
let clientBundle: Promise<string> | undefined;

async function loadClientBundle(): Promise<string> {
  const result = await build({
    stdin: {
      contents: `
        import { createElement, useEffect } from "react";
        import { hydrateRoot } from "react-dom/client";
        import * as fixtures from "./e2e/layout/fixtures";
        function Hydrated({ children }) {
          // A parent's effects run after its children's: when this is set, every fixture effect has run.
          useEffect(() => void (document.documentElement.dataset.hydrated = "true"), []);
          return children;
        }
        window.__hydrate = (name, props) =>
          hydrateRoot(document.getElementById("root"), createElement(Hydrated, null, createElement(fixtures[name], props)));
      `,
      resolveDir: ROOT,
      loader: "tsx",
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    tsconfig: path.join(ROOT, "tsconfig.json"),
    plugins: [providerActionsStub],
    define: { "process.env.NODE_ENV": '"production"' },
    minify: true,
    write: false,
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

type FixtureName = keyof typeof Fixtures;

export type MountOptions = {
  lang?: string;
  basic?: boolean;
  /** Test-only CSS for the fixture's frame, such as a wrong breakpoint switch to prove a test fails. */
  frameCss?: string;
};

function documentFor(html: string, css: string, { lang = "en", basic = false, frameCss = "" }: MountOptions = {}) {
  const attributes = [`lang="${lang}"`, `dir="${RTL.has(lang) ? "rtl" : "ltr"}"`, basic ? 'data-basic="true"' : ""].join(" ");
  return (
    `<!doctype html><html ${attributes}><head><meta charset="utf-8"><style>${fontCss()}</style><style>${css}</style>` +
    `<style>${frameCss}</style></head><body>${html}</body></html>`
  );
}

export async function mount<Name extends FixtureName>(
  page: Page,
  name: Name,
  props: ComponentProps<(typeof Fixtures)[Name]>,
  { lang = "en", basic = false, frameCss = "" }: MountOptions = {},
) {
  const render = await (renderer ??= loadRenderer());
  await page.setContent(documentFor(render(name, props), await appCss(), { lang, basic, frameCss }));
  await expectPublicSansLoaded(page);
}

/** Like `mount`, then hydrates the fixture in the page and waits until its effects have run. */
export async function mountHydrated<Name extends FixtureName>(
  page: Page,
  name: Name,
  props: ComponentProps<(typeof Fixtures)[Name]>,
  options: MountOptions = {},
) {
  const render = await (renderer ??= loadRenderer());
  const html = `<div id="root" style="display: contents">${render(name, props)}</div>`;
  await page.setContent(documentFor(html, await appCss(), options));
  await page.addScriptTag({ content: await (clientBundle ??= loadClientBundle()) });
  await page.evaluate(([fixture, fixtureProps]) => (window as unknown as { __hydrate: (n: string, p: unknown) => void }).__hydrate(fixture, fixtureProps), [name, props] as const);
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  await expectPublicSansLoaded(page);
}
