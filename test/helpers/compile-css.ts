import { readFileSync } from "node:fs";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";

/**
 * Compiles a stylesheet with the pinned Tailwind (the PostCSS plugin the app's build uses).
 * `optimize` adds the Lightning CSS pass a production build runs.
 */
export async function compileCss(file: string, { optimize = false } = {}): Promise<string> {
  const result = await postcss([tailwind({ optimize: optimize ? { minify: false } : false })]).process(
    readFileSync(file, "utf8"),
    { from: file },
  );
  return result.css;
}
