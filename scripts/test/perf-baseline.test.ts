import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  bundleChunks,
  bundleMeasures,
  entryFile,
  eventStoreMeasures,
  formatReport,
  type Machine,
  machineTag,
  runSteps,
} from "../lib/perf-baseline.ts";

const machine: Machine = {
  tag: "Pi",
  os: "linux",
  arch: "arm64",
  cpu: "Cortex",
  cores: 8,
  load1: 0.5,
  bun: "1.4.4",
  date: "2026-11-01",
};

describe("perf-baseline: the machine a number is from", () => {
  test("a CI runner is named after its OS, the Pi is a linux arm64 outside CI, anything else is local", () => {
    expect(machineTag({ CI: "true", RUNNER_OS: "Windows" }, "win32", "x64")).toBe("ci-windows");
    expect(machineTag({ CI: "true", RUNNER_OS: "Linux" }, "linux", "x64")).toBe("ci-linux");
    expect(machineTag({}, "linux", "arm64")).toBe("Pi");
    expect(machineTag({}, "win32", "x64")).toBe("local-win32");
    expect(machineTag({}, "linux", "x64")).toBe("local-linux");
  });
});

describe("perf-baseline: question 1, the bundle", () => {
  function dist() {
    const dir = mkdtempSync(join(tmpdir(), "fd-dist-"));
    mkdirSync(join(dir, "assets"));
    const big = "a".repeat(5000);
    writeFileSync(join(dir, "assets", "index-abc.js"), "x".repeat(100));
    writeFileSync(join(dir, "assets", "vendor-def.js"), big);
    writeFileSync(join(dir, "assets", "style.css"), "body{}");
    writeFileSync(
      join(dir, "index.html"),
      '<html><script type="module" crossorigin src="/assets/index-abc.js"></script></html>',
    );
    return dir;
  }

  test("the entry script is the one the page loads, nothing when it loads none", () => {
    expect(
      entryFile('<script type="module" crossorigin src="/assets/index-abc.js"></script>'),
    ).toBe("index-abc.js");
    expect(entryFile("<html></html>")).toBeNull();
  });

  test("chunks are the .js files of the assets folder, largest first, with raw and gzip sizes", () => {
    const chunks = bundleChunks(dist());
    expect(chunks.map((c) => c.file)).toEqual(["vendor-def.js", "index-abc.js"]);
    expect(chunks[0]?.bytes).toBe(5000);
    expect(chunks[0]?.gzip).toBe(gzipSync("a".repeat(5000)).length);
  });

  test("the measures are the entry chunk and the five largest, raw and gzip", () => {
    const chunks = Array.from({ length: 7 }, (_, i) => ({
      file: `c${i}.js`,
      bytes: 1000 - i,
      gzip: 100 - i,
    }));
    const measures = bundleMeasures(chunks, "c6.js");
    expect(measures.every((m) => m.question === 1)).toBe(true);
    expect(measures.map((m) => m.name)).toEqual([
      "entry c6.js (raw)",
      "entry c6.js (gzip)",
      ...[0, 1, 2, 3, 4].flatMap((i) => [`chunk c${i}.js (raw)`, `chunk c${i}.js (gzip)`]),
    ]);
    expect(measures[0]).toMatchObject({ value: 994, unit: "bytes" });
    expect(measures[1]).toMatchObject({ value: 94, unit: "bytes" });
  });

  test("without an entry chunk the measures say so and still list the largest", () => {
    const measures = bundleMeasures([{ file: "a.js", bytes: 10, gzip: 5 }], null);
    expect(measures[0]).toMatchObject({ name: "entry chunk", value: null });
    expect(measures[0]?.note).toContain("no entry");
    expect(measures.map((m) => m.name)).toContain("chunk a.js (raw)");
  });
});

describe("perf-baseline: question 9, persisted events", () => {
  test("a store with the given synchronous writes the events and reports their rate and commit latency", () => {
    const dir = mkdtempSync(join(tmpdir(), "fd-store-"));
    const measures = eventStoreMeasures(dir, "FULL", 50);
    expect(measures.map((m) => [m.question, m.name, m.unit])).toEqual([
      [9, "events/s (synchronous=FULL)", "events/s"],
      [9, "commit p50 (synchronous=FULL)", "ms"],
      [9, "commit p95 (synchronous=FULL)", "ms"],
    ]);
    for (const m of measures) expect(m.value).toBeGreaterThan(0);
    const normal = eventStoreMeasures(dir, "NORMAL", 10);
    expect(normal[0]?.name).toBe("events/s (synchronous=NORMAL)");
  });
});

describe("perf-baseline: running and reporting", () => {
  test("a step that throws becomes a measure with no value and its reason; the others still run", () => {
    const measures = runSteps([
      { question: 1, name: "bundle", run: () => [{ question: 1, name: "a", value: 1, unit: "x" }] },
      {
        question: 2,
        name: "start",
        run: () => {
          throw new Error("no dist");
        },
      },
    ]);
    expect(measures).toEqual([
      { question: 1, name: "a", value: 1, unit: "x" },
      { question: 2, name: "start", value: null, unit: "", note: "failed: no dist" },
    ]);
  });

  test("the report names the machine, lists every measure and has a row for each question not measured", () => {
    const text = formatReport(machine, [
      { question: 1, name: "entry (raw)", value: 1234, unit: "bytes" },
      { question: 9, name: "events/s", value: 2700.456, unit: "events/s" },
      { question: 9, name: "commit p95", value: null, unit: "ms", note: "failed: x" },
    ]);
    expect(text).toContain(
      "Machine: Pi (linux arm64, Cortex, 8 cores, load 0.5, Bun 1.4.4, 2026-11-01)",
    );
    expect(text).toContain("| 1 | entry (raw) | 1,234 | bytes |  |");
    expect(text).toContain("| 9 | events/s | 2,700.46 | events/s |  |");
    expect(text).toContain("| 9 | commit p95 |  | ms | failed: x |");
    for (const q of [2, 3, 4, 5, 6, 7, 8]) {
      expect(text).toContain(`| ${q} | not measured by this script |  |  |  |`);
    }
    expect(text).not.toContain("| 1 | not measured");
  });
});
