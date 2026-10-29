#!/usr/bin/env bun
/**
 * Writes apps/desktop/components.lock.json: the hash of each shadcn/ui component as the CLI
 * generated it (plus `biome format`). Run after `shadcn add`; the base-ui test fails when a file
 * no longer matches, which means it was edited by hand (see docs/DECISIONS.md, phase 10).
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const desktop = resolve(import.meta.dir, "../apps/desktop");
const dir = resolve(desktop, "src/components/ui");
const files = Object.fromEntries(
  readdirSync(dir)
    .sort()
    .map((file) => [
      file,
      createHash("sha256")
        .update(readFileSync(resolve(dir, file), "utf8").replaceAll("\r", ""))
        .digest("hex"),
    ]),
);
const lock = { shadcn: "4.23.0", files };
writeFileSync(resolve(desktop, "components.lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
console.log(`components.lock.json: ${Object.keys(files).length} componentes`);
