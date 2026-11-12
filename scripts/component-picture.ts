#!/usr/bin/env bun
/**
 * `bun run arch:picture`: regenerates docs/decisions/2026-11-10-context-map-components.md, the C4
 * component level of the context map, from dependency-cruiser's import graph (issue #1624). The
 * rules are not run, only the edges. The logic is scripts/lib/component-picture.ts.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cruise } from "dependency-cruiser";
import { componentPicture, type PictureModule } from "./lib/component-picture.ts";

const ROOT = resolve(import.meta.dir, "..");
const OUT = "docs/decisions/2026-11-10-context-map-components.md";

// dependency-cruiser resolves the roots and the tsconfig from the working directory
process.chdir(ROOT);
const { options } = require("../.dependency-cruiser.cjs") as { options: Record<string, unknown> };
const result = await cruise(
  ["apps/daemon/src", "apps/desktop/src", "packages/protocol/src"],
  options as Parameters<typeof cruise>[1],
);
writeFileSync(
  resolve(ROOT, OUT),
  componentPicture((result.output as { modules: PictureModule[] }).modules),
);
console.log(`component-picture: wrote ${OUT}`);
