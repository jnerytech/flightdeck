/**
 * `bun run layout:ratchet` lowers `apps/desktop/layout-baseline.json` to the screens' current
 * counts after a migration (it never raises one). `--init` writes the counts as they are, once:
 * it is refused while the baseline has entries.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { initialised, type LayoutBaseline, screenCounts, tightened } from "./lib/layout-ratchet.ts";

const DESKTOP = resolve(import.meta.dir, "../apps/desktop");
const FILE = resolve(DESKTOP, "layout-baseline.json");

const counts = screenCounts(resolve(DESKTOP, "src/ui"), DESKTOP);
const baseline: LayoutBaseline = existsSync(FILE)
  ? (JSON.parse(readFileSync(FILE, "utf8")) as LayoutBaseline)
  : {};
const init = process.argv.includes("--init");
const next = init ? initialised(counts, baseline) : tightened(counts, baseline);
if (next === null) {
  console.error("layout baseline already has entries: --init would raise it. Run without --init.");
  process.exit(1);
}
const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(FILE, `${JSON.stringify(sorted, null, 2)}\n`);
const total = Object.values(sorted).reduce((sum, n) => sum + n, 0);
console.log(`layout baseline: ${Object.keys(sorted).length} files, ${total} raw utilities`);
