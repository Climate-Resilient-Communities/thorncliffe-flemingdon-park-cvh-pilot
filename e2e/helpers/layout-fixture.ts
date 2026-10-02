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

type FixtureName = keyof typeof Fixtures;

export type MountOptions = {
  lang?: string;
  basic?: boolean;
  /** Test-only CSS for the fixture's frame, such as a stand-in shell. */
  frameCss?: string;
};

export async function mount<Name extends FixtureName>(
  page: Page,
  name: Name,
  props: ComponentProps<(typeof Fixtures)[Name]>,
  { lang = "en", basic = false, frameCss = "" }: MountOptions = {},
) {
  const render = await (renderer ??= loadRenderer());
  const attributes = [`lang="${lang}"`, `dir="${RTL.has(lang) ? "rtl" : "ltr"}"`, basic ? 'data-basic="true"' : ""].join(" ");
  await page.setContent(
    `<!doctype html><html ${attributes}><head><meta charset="utf-8"><style>${await appCss()}</style>` +
      `<style>${frameCss}</style></head><body>${render(name, props)}</body></html>`,
  );
}
