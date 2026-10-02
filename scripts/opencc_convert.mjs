#!/usr/bin/env node
// Simplified to Traditional conversion for the offline content scripts (S02.09, AD-10):
// zh-Hant is produced from approved zh by OpenCC (opencc-js, the package the app pins),
// never by a model. Reads {"texts": {key: text}} on stdin and writes
// {"openccVersion", "config", "texts"} on stdout, so the caller can record the OpenCC
// version and configuration beside each converted text.
//
//   echo '{"texts":{"a":"软件"}}' | node scripts/opencc_convert.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Converter } from "opencc-js";

const require = createRequire(import.meta.url);
// The package's exports map hides package.json, so find it above the resolved entry point.
let dir = path.dirname(require.resolve("opencc-js"));
while (path.basename(dir) !== "opencc-js" && path.dirname(dir) !== dir) dir = path.dirname(dir);
const openccVersion = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version;

// Simplified (Mainland) to Traditional (Taiwan standard, with Taiwan phrases): OpenCC's s2twp,
// matching the BCP-47 tag zh-Hant-TW the app uses for zh-Hant.
const FROM = "cn";
const TO = "twp";
const convert = Converter({ from: FROM, to: TO });

const input = JSON.parse(readFileSync(0, "utf8"));
const texts = Object.fromEntries(Object.entries(input.texts ?? {}).map(([key, text]) => [key, convert(text)]));
process.stdout.write(
  JSON.stringify({ openccVersion, config: `opencc-js Converter({ from: "${FROM}", to: "${TO}" }) (OpenCC s2twp)`, texts }) + "\n",
);
