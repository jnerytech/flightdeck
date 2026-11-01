/** Phase 28 baseline: the numbers every performance area is compared against. */
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { EventStore } from "../../apps/daemon/src/store/event-store.ts";

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
  env: Record<string, string | undefined>,
  platform: string,
  arch: string,
): string {
  if (env.CI && env.RUNNER_OS) return `ci-${env.RUNNER_OS.toLowerCase()}`;
  if (platform === "linux" && arch === "arm64") return "Pi";
  return `local-${platform}`;
}

/** The entry script of a built `index.html`, as a file name inside the assets folder. */
export function entryFile(html: string): string | null {
  return /<script[^>]*\ssrc="[^"]*\/assets\/([^"/]+\.js)"/.exec(html)?.[1] ?? null;
}

/** Every `.js` file of a Vite build's assets folder, largest first, with its gzip size. */
export function bundleChunks(distDir: string): Chunk[] {
  const assets = join(distDir, "assets");
  return readdirSync(assets)
    .filter((file) => file.endsWith(".js"))
    .map((file) => {
      const content = readFileSync(join(assets, file));
      return { file, bytes: statSync(join(assets, file)).size, gzip: gzipSync(content).length };
    })
    .sort((a, b) => b.bytes - a.bytes);
}

const sizes = (label: string, chunk: Chunk): Measure[] => [
  { question: 1, name: `${label} (raw)`, value: chunk.bytes, unit: "bytes" },
  { question: 1, name: `${label} (gzip)`, value: chunk.gzip, unit: "bytes" },
];

/** The entry chunk and the five largest, as measures of question 1. */
export function bundleMeasures(chunks: Chunk[], entry: string | null): Measure[] {
  const found = chunks.find((chunk) => chunk.file === entry);
  const first: Measure[] = found
    ? sizes(`entry ${found.file}`, found)
    : [
        {
          question: 1,
          name: "entry chunk",
          value: null,
          unit: "bytes",
          note: "no entry chunk found",
        },
      ];
  return [...first, ...chunks.slice(0, 5).flatMap((chunk) => sizes(`chunk ${chunk.file}`, chunk))];
}

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

/** Writes `events` events one transaction each into a fresh store with the given `synchronous`. */
export function eventStoreMeasures(
  dir: string,
  synchronous: "FULL" | "NORMAL",
  events: number,
): Measure[] {
  mkdirSync(dir, { recursive: true });
  const store = new EventStore(join(dir, `events-${synchronous}-${Date.now()}.db`));
  store.db.exec(`PRAGMA synchronous = ${synchronous};`);
  store.createSession({
    id: "bench",
    name: null,
    cwd: dir,
    status: "idle",
    permissionMode: "default",
    model: null,
  });
  const commits: number[] = [];
  const started = performance.now();
  for (let i = 0; i < events; i++) {
    const at = performance.now();
    store.appendEvent("bench", { type: "message.user", text: `event ${i} ${"x".repeat(200)}` });
    commits.push(performance.now() - at);
  }
  const seconds = (performance.now() - started) / 1000;
  store.close();
  commits.sort((a, b) => a - b);
  const label = `synchronous=${synchronous}`;
  return [
    { question: 9, name: `events/s (${label})`, value: events / seconds, unit: "events/s" },
    { question: 9, name: `commit p50 (${label})`, value: percentile(commits, 0.5), unit: "ms" },
    { question: 9, name: `commit p95 (${label})`, value: percentile(commits, 0.95), unit: "ms" },
  ];
}

/** Runs each step; a step that throws becomes one measure with no value and the reason. */
export function runSteps(
  steps: Array<{ question: number; name: string; run: () => Measure[] }>,
): Measure[] {
  return steps.flatMap((step) => {
    try {
      return step.run();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return [
        {
          question: step.question,
          name: step.name,
          value: null,
          unit: "",
          note: `failed: ${reason}`,
        },
      ];
    }
  });
}

const QUESTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const number = (value: number | null) =>
  value === null ? "" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** The report as a Markdown table, with a row for every question that has no measure yet. */
export function formatReport(machine: Machine, measures: Measure[]): string {
  const rows = QUESTIONS.flatMap((q) => {
    const own = measures.filter((m) => m.question === q);
    if (own.length === 0) return [`| ${q} | not measured by this script |  |  |  |`];
    return own.map(
      (m) => `| ${q} | ${m.name} | ${number(m.value)} | ${m.unit} | ${m.note ?? ""} |`,
    );
  });
  return [
    `Machine: ${machine.tag} (${machine.os} ${machine.arch}, ${machine.cpu}, ${machine.cores} cores, load ${machine.load1}, Bun ${machine.bun}, ${machine.date})`,
    "",
    "| Question | Measure | Value | Unit | Note |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}
