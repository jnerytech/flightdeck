/**
 * The test pyramid of a run, per tier (#1854): how many files and tests each tier holds, how long
 * its tests took and which file was the slowest. Built from the bun shard jobs' JUnit files (the
 * istanbul twins ran the same files, with skewed times, and are not counted) and the tier of each
 * test file (#261). A tier no job ran, as in a PR's selection, reads as none, not as zero.
 */
import type { ShardMarker } from "./shard-gate.ts";
import { TIERS, type Tier } from "./test-tiers.ts";

interface TierRow {
  tier: Tier;
  /** The test files of the tier in the tree. */
  files: number;
  tests: number | null;
  /** The summed seconds of the tier's files that ran. */
  seconds: number | null;
  slowest: { file: string; seconds: number } | null;
}

interface Pyramid {
  rows: TierRow[];
  /** Each shard job's wall time, in the order the plan runs them. */
  jobs: Array<{ name: string; seconds: number }>;
}

interface Ran {
  file: string;
  tests: number;
  seconds: number;
}

/** The files a JUnit file of `bun test` reports: a file's own suite is named after it. */
function ranIn(xml: string): Ran[] {
  const out: Ran[] = [];
  for (const tag of xml.matchAll(/<testsuite\s([^>]*)>/g)) {
    const attrs = Object.fromEntries(
      [...(tag[1] ?? "").matchAll(/\b([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
    );
    if (!attrs.name || attrs.name !== attrs.file || "line" in attrs) continue;
    const seconds = Number(attrs.time);
    const tests = Number(attrs.tests);
    if (Number.isFinite(seconds) && Number.isFinite(tests)) {
      out.push({ file: attrs.name, tests, seconds });
    }
  }
  return out;
}

export function pyramidOf(
  tiers: Record<string, Tier>,
  jobs: ReadonlyArray<{ marker: ShardMarker | null; junit: string | null }>,
): Pyramid {
  const bun = jobs.filter((job) => job.marker?.kind === "bun");
  const ran = bun.flatMap((job) => (job.junit ? ranIn(job.junit) : []));
  const rows = TIERS.map((tier): TierRow => {
    const mine = ran.filter((r) => tiers[r.file] === tier);
    const slowest = mine.reduce<Ran | null>((a, r) => (!a || r.seconds > a.seconds ? r : a), null);
    return {
      tier,
      files: Object.values(tiers).filter((t) => t === tier).length,
      tests: mine.length > 0 ? mine.reduce((sum, r) => sum + r.tests, 0) : null,
      seconds: mine.length > 0 ? mine.reduce((sum, r) => sum + r.seconds, 0) : null,
      slowest: slowest ? { file: slowest.file, seconds: slowest.seconds } : null,
    };
  });
  const named = bun
    .flatMap((job) => (job.marker?.tier && job.marker.seconds !== undefined ? [job.marker] : []))
    .sort((a, b) => a.shard - b.shard);
  return {
    rows,
    jobs: named.map((m) => ({ name: m.tier as string, seconds: m.seconds as number })),
  };
}

const secs = (n: number | null) => (n === null ? "–" : `${n.toFixed(1)} s`);

/** The job summary's markdown: one line per tier, then each job's wall time. */
export function renderPyramid(pyramid: Pyramid): string {
  const lines = [
    "### Test pyramid",
    "",
    "| tier | files | tests | test time | slowest file |",
    "| --- | ---: | ---: | ---: | --- |",
    ...pyramid.rows.map(
      (r) =>
        `| ${r.tier} | ${r.files} | ${r.tests ?? "–"} | ${secs(r.seconds)} | ${
          r.slowest ? `${r.slowest.file} (${secs(r.slowest.seconds)})` : "–"
        } |`,
    ),
  ];
  if (pyramid.jobs.length > 0) {
    lines.push("", "| job | wall time |", "| --- | ---: |");
    for (const job of pyramid.jobs) lines.push(`| ${job.name} | ${secs(job.seconds)} |`);
  }
  return `${lines.join("\n")}\n`;
}

/** The table a local run prints at its end (#1854); a stub. */
export function localPyramid(_tiers: Record<string, Tier>, _junit: string | null): string {
  return "";
}
