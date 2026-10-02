import path from "node:path";
import type { Page } from "@playwright/test";
import { build } from "esbuild";
import type { ComponentProps } from "react";
import type * as Fixtures from "../layout/fixtures";
import { compileCss } from "../../test/helpers/compile-css";

// Layout fixtures are rendered to static HTML with react-dom/server and loaded with page.setContent
// together with the app's compiled stylesheet, so the tests need no server and add no route to the app.
const ROOT = path.join(__dirname, "..", "..");
const RTL = new Set(["ur", "ps", "prs"]);

type Render = (name: string, props: unknown) => string;

let stylesheet: Promise<string> | undefined;
let renderer: Promise<Render> | undefined;

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
    `<!doctype html><html ${attributes}><head><meta charset="utf-8"><style>${css}</style>` +
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
}
