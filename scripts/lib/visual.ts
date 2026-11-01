import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export type VisualMode = "off" | "record" | "compare" | "update";

const MODES: readonly VisualMode[] = ["off", "record", "compare", "update"];

/** `VISUAL=record|compare|off` (CI) or `--update` (a person, for a change meant to show). */
export function visualMode(
  env: Record<string, string | undefined>,
  argv: readonly string[],
): VisualMode {
  if (argv.includes("--update")) return "update";
  const asked = env.VISUAL ?? "off";
  const mode = MODES.find((m) => m === asked);
  if (!mode) throw new Error(`VISUAL=${asked}: use off, record or compare (or --update)`);
  return mode;
}

export interface Compared {
  status: "same" | "different" | "size" | "new";
  diffPixels: number;
  /** A PNG of what differs; only for `different`. */
  diff?: Buffer;
}

export interface CompareOptions {
  /** pixelmatch's color distance, 0 to 1 (0.1 by default). */
  threshold?: number;
  /** The share of the image that may differ before it counts (0.0002 by default). */
  maxDiffRatio?: number;
}

const DEFAULT_RATIO = 0.0002;

/** One print against its baseline (`null` when there is none yet). */
export function comparePng(
  baseline: Buffer | null,
  current: Buffer,
  options: CompareOptions = {},
): Compared {
  if (baseline === null) return { status: "new", diffPixels: 0 };
  const before = PNG.sync.read(baseline);
  const after = PNG.sync.read(current);
  if (before.width !== after.width || before.height !== after.height) {
    return { status: "size", diffPixels: after.width * after.height };
  }
  const { width, height } = after;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(before.data, after.data, diff.data, width, height, {
    threshold: options.threshold ?? 0.1,
  });
  const allowed = Math.floor(width * height * (options.maxDiffRatio ?? DEFAULT_RATIO));
  if (diffPixels <= allowed) return { status: "same", diffPixels: 0 };
  return { status: "different", diffPixels, diff: PNG.sync.write(diff) };
}

export interface VisualIO {
  /** The `.png` files below `dir`, as paths relative to it, `/`-separated. */
  list(dir: string): string[];
  exists(path: string): boolean;
  read(path: string): Buffer;
  write(path: string, data: Buffer): void;
}

export interface VisualCheck {
  mode: VisualMode;
  shotsDir: string;
  baselineDir: string;
  diffDir: string;
  io: VisualIO;
  /** Every screen was printed (no `DEMO_SHOTS` filter): a baseline with no print is a problem. */
  complete: boolean;
  options?: CompareOptions;
}

/** Where the diff folder sits inside the prints: its files are not prints. */
const isDiff = (rel: string) => rel.startsWith("visual-diff/");

const sizeOf = (png: Buffer) => {
  const { width, height } = PNG.sync.read(png);
  return `${width}x${height}`;
};

/** Runs the mode over the prints just taken; the problems fail the job. */
export function checkShots(check: VisualCheck): {
  problems: string[];
  compared: number;
  updated: number;
} {
  const { io, shotsDir, baselineDir, diffDir } = check;
  const shots = io.list(shotsDir).filter((rel) => !isDiff(rel));
  const problems: string[] = [];
  let compared = 0;
  let updated = 0;
  if (check.mode === "update") {
    for (const rel of shots) {
      io.write(`${baselineDir}/${rel}`, io.read(`${shotsDir}/${rel}`));
      updated++;
    }
    return { problems, compared, updated };
  }
  if (check.mode !== "compare") return { problems, compared, updated };
  for (const rel of shots) {
    const current = io.read(`${shotsDir}/${rel}`);
    const path = `${baselineDir}/${rel}`;
    if (!io.exists(path)) {
      problems.push(`${rel}: no baseline (record in CI, review, then commit it)`);
      continue;
    }
    const baseline = io.read(path);
    compared++;
    const result = comparePng(baseline, current, check.options);
    if (result.status === "size") {
      problems.push(`${rel}: the size changed (${sizeOf(baseline)} to ${sizeOf(current)})`);
    } else if (result.status === "different") {
      const total = PNG.sync.read(current);
      const share = ((result.diffPixels / (total.width * total.height)) * 100).toFixed(4);
      problems.push(`${rel}: ${result.diffPixels} pixels differ (${share}%)`);
      const stem = rel.replace(/\.png$/, "");
      io.write(`${diffDir}/${rel}`, result.diff as Buffer);
      io.write(`${diffDir}/${stem}.actual.png`, current);
      io.write(`${diffDir}/${stem}.expected.png`, baseline);
    }
  }
  if (check.complete) {
    const printed = new Set(shots);
    for (const rel of io.list(baselineDir)) {
      if (!printed.has(rel)) {
        problems.push(
          `${rel}: a baseline with no print (a screen that went away? run with --update)`,
        );
      }
    }
  }
  return { problems, compared, updated };
}
