/** Phase 28 baseline: the numbers every performance area is compared against. */

export interface Measure {
  /** The question of the spec's "Baseline first" list (1 to 9). */
  question: number;
  name: string;
  value: number | null;
  unit: string;
  /** Why there is no value, or what the value is not. */
  note?: string;
}

export interface Chunk {
  file: string;
  bytes: number;
  gzip: number;
}

export interface Machine {
  tag: string;
  os: string;
  arch: string;
  cpu: string;
  cores: number;
  load1: number;
  bun: string;
  date: string;
}

/** Which machine the numbers are from: a CI runner, the shared Pi, or any other. */
export function machineTag(
  _env: Record<string, string | undefined>,
  _platform: string,
  _arch: string,
): string {
  return "";
}

/** The entry script of a built `index.html`, as a file name inside the assets folder. */
export function entryFile(_html: string): string | null {
  return "";
}

/** Every `.js` file of a Vite build's assets folder, largest first, with its gzip size. */
export function bundleChunks(_distDir: string): Chunk[] {
  return [];
}

/** The entry chunk and the five largest, as measures of question 1. */
export function bundleMeasures(_chunks: Chunk[], _entry: string | null): Measure[] {
  return [];
}

/** Writes `events` events one transaction each into a fresh store with the given `synchronous`. */
export function eventStoreMeasures(
  _dir: string,
  _synchronous: "FULL" | "NORMAL",
  _events: number,
): Measure[] {
  return [];
}

/** Runs each step; a step that throws becomes one measure with no value and the reason. */
export function runSteps(
  _steps: Array<{ question: number; name: string; run: () => Measure[] }>,
): Measure[] {
  return [];
}

/** The report as a Markdown table, with a row for every question that has no measure yet. */
export function formatReport(_machine: Machine, _measures: Measure[]): string {
  return "";
}
