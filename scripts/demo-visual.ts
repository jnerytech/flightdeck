/**
 * The visual check of the prints (`VISUAL=record|compare`, or `--update`): the real files under
 * the logic of scripts/lib/visual.ts. Baselines are committed in apps/desktop/visual-baseline,
 * taken from the CI runner (Linux x64), never from another machine: fonts differ.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { checkShots, type VisualIO, type VisualMode } from "./lib/visual.ts";

export const BASELINE_DIR = resolve(import.meta.dir, "../apps/desktop/visual-baseline");

const diskIO: VisualIO = {
  list: (dir) => {
    try {
      return readdirSync(dir, { recursive: true, encoding: "utf8" })
        .map((path) => path.replaceAll("\\", "/"))
        .filter((path) => path.endsWith(".png"))
        .sort();
    } catch {
      return [];
    }
  },
  exists: (path) => {
    try {
      readFileSync(path);
      return true;
    } catch {
      return false;
    }
  },
  read: (path) => readFileSync(path),
  write: (path, data) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  },
};

/** Throws, with every print that differs, when `compare` finds a problem. */
export function runVisual(mode: VisualMode, shotsDir: string, log: (msg: string) => void): void {
  if (mode === "off") return;
  const result = checkShots({
    mode,
    shotsDir,
    baselineDir: BASELINE_DIR,
    diffDir: join(shotsDir, "visual-diff"),
    io: diskIO,
    // `DEMO_SHOTS` prints only some screens: then a baseline with no print is expected.
    complete: !process.env.DEMO_SHOTS,
  });
  if (mode === "update") log(`visual: ${result.updated} baselines written to ${BASELINE_DIR}`);
  else if (mode === "record")
    log("visual: recorded, the prints are the candidates for the baselines");
  else log(`visual: ${result.compared} prints compared`);
  if (result.problems.length > 0) {
    throw new Error(`visual: ${result.problems.length} problems\n${result.problems.join("\n")}`);
  }
}
