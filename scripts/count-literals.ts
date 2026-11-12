import { readdirSync, readFileSync } from "node:fs";
import { visibleLiterals } from "./lib/i18n-sweep.ts";

const FEATURES = "apps/desktop/src/features";
const dirs = [
  "apps/desktop/src/ui",
  "apps/desktop/src/components/approval",
  "apps/desktop/src/components/feedback",
  "apps/desktop/src/shared/feedback",
  "apps/desktop/src/components/layout",
  "apps/desktop/src/shared/status",
  // Screens move into their feature folder (#1597): a domain's folder is swept like the rest.
  ...readdirSync(FEATURES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${FEATURES}/${entry.name}`),
];
const verbose = process.argv.includes("--list");
let total = 0;
for (const dir of dirs) {
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".tsx"))) {
    const literals = visibleLiterals(readFileSync(`${dir}/${file}`, "utf8"));
    if (literals.length) console.log(String(literals.length).padStart(4), `${dir}/${file}`);
    if (verbose) for (const l of literals) console.log(`      ${l.line}: ${l.text.slice(0, 110)}`);
    total += literals.length;
  }
}
console.log("TOTAL", total);
