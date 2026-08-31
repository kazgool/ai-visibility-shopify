// Guards the one Liquid mistake that nothing else in this repo catches.
//
// `shopify app deploy` is the first and only place extension Liquid is
// parsed, so a syntax error there is discovered at release time, in front of
// a merchant, after everything else has gone green. Theme check does not
// catch it: run against a file containing the exact failure below, it reports
// no offenses.
//
// The failure: a literal brace inside a `{{ ... }}` output tag ends the tag
// early in Liquid's lexer. It cost a failed release on 31 August 2026 with
//
//   "urlTemplate": {{ shop.url | append: "/search?q={search_term_string}" | json }}
//
// which Shopify rejected as "not properly terminated with regexp: /\}\}/".
// The fix is to keep the literal braces outside the tag:
//
//   "urlTemplate": "{{ shop.url }}/search?q={search_term_string}"
//
// This is deliberately narrow. It checks one thing and says so, rather than
// pretending to be a Liquid parser.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "extensions";

function liquidFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...liquidFiles(path));
    else if (entry.endsWith(".liquid")) out.push(path);
  }
  return out;
}

/** Every `{{ ... }}` span, with the line it starts on. */
function outputTags(source) {
  const tags = [];
  const pattern = /\{\{(.*?)\}\}/gs;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const line = source.slice(0, match.index).split("\n").length;
    tags.push({ line, body: match[1], text: match[0] });
  }
  return tags;
}

let failures = 0;

for (const file of liquidFiles(ROOT)) {
  const source = readFileSync(file, "utf8");
  for (const tag of outputTags(source)) {
    if (!/[{}]/.test(tag.body)) continue;
    failures += 1;
    console.error(
      `${file}:${tag.line}: literal brace inside an output tag.\n` +
        `  ${tag.text.trim()}\n` +
        `  Liquid ends the tag at the first brace it meets, so this fails at\n` +
        `  'shopify app deploy' and nowhere earlier. Move the braces outside\n` +
        `  the tag: "{{ value }}/path?q={placeholder}".`,
    );
  }
}

if (failures > 0) {
  console.error(`\ncheck-liquid: ${failures} problem${failures === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("check-liquid: no literal braces inside output tags.");
