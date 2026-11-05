#!/usr/bin/env bun
/**
 * `bun run scripts/protocol-surface.ts [--write]`: compares the protocol's surface with its release
 * baseline (scripts/lib/protocol-surface.ts) and lists what was lost. `--write` refreshes
 * packages/protocol/surface-baseline.txt; run it at release only, so that branches adding to the
 * protocol never touch the baseline.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as protocol from "../packages/protocol/src/index.ts";
import { removed, walkSchema } from "./lib/protocol-surface.ts";

const BASELINE = join(resolve(import.meta.dir, ".."), "packages/protocol/surface-baseline.txt");
const current = Object.entries(protocol)
  .filter(([, value]) => typeof value === "object" && value !== null && "_zod" in value)
  .flatMap(([name, schema]) =>
    walkSchema(
      name,
      (schema as { toJSONSchema(o: object): unknown }).toJSONSchema({
        unrepresentable: "any",
        io: "input",
      }),
    ),
  );

if (process.argv.includes("--write")) {
  const lines = [...new Set(current)].sort();
  writeFileSync(BASELINE, `${lines.join("\n")}\n`);
  console.log(`protocol-surface: ${lines.length} line(s) written to ${BASELINE}`);
  process.exit(0);
}
const baseline = existsSync(BASELINE)
  ? readFileSync(BASELINE, "utf8").split("\n").filter(Boolean)
  : [];
const lost = removed(baseline, current);
const gone = lost.map((l) => `  ${l}`).join("\n");
console.log(
  lost.length === 0
    ? `protocol-surface: OK (${baseline.length} baseline line(s) kept)`
    : `protocol-surface: ${lost.length} line(s) of the release baseline are gone:\n${gone}`,
);
process.exit(lost.length === 0 ? 0 : 1);
