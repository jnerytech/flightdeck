import { describe, expect, test } from "bun:test";
import { PNG } from "pngjs";
import {
  checkShots,
  comparePng,
  type VisualCheck,
  type VisualIO,
  visualMode,
} from "../lib/visual.ts";

/** A solid-color PNG; `paint` turns some pixels another color. */
function image(
  width: number,
  height: number,
  color: [number, number, number],
  paint: Array<[number, number]> = [],
): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      const other = paint.some(([px, py]) => px === x && py === y);
      const [r, g, b] = other ? [255 - color[0], 255 - color[1], 255 - color[2]] : color;
      png.data[at] = r;
      png.data[at + 1] = g;
      png.data[at + 2] = b;
      png.data[at + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

describe("visual: the mode", () => {
  test("off by default, VISUAL picks record or compare, --update wins", () => {
    expect(visualMode({}, [])).toBe("off");
    expect(visualMode({ VISUAL: "record" }, [])).toBe("record");
    expect(visualMode({ VISUAL: "compare" }, [])).toBe("compare");
    expect(visualMode({ VISUAL: "compare" }, ["--shots", "--update"])).toBe("update");
    expect(visualMode({ VISUAL: "off" }, [])).toBe("off");
  });

  test("a mode nobody knows is refused, not run as off", () => {
    expect(() => visualMode({ VISUAL: "compre" }, [])).toThrow("VISUAL=compre");
  });
});

describe("visual: one print against its baseline", () => {
  test("equal images are the same; no baseline is new", () => {
    const a = image(20, 20, [10, 20, 30]);
    expect(comparePng(a, image(20, 20, [10, 20, 30]))).toEqual({ status: "same", diffPixels: 0 });
    expect(comparePng(null, a)).toEqual({ status: "new", diffPixels: 0 });
  });

  test("a change beyond the share of the image differs, and the diff is a PNG of that size", () => {
    const base = image(20, 20, [10, 20, 30]);
    const changed = image(
      20,
      20,
      [10, 20, 30],
      [
        [1, 1],
        [2, 2],
        [3, 3],
      ],
    );
    const result = comparePng(base, changed, { maxDiffRatio: 0 });
    expect(result.status).toBe("different");
    expect(result.diffPixels).toBe(3);
    const diff = PNG.sync.read(result.diff as Buffer);
    expect([diff.width, diff.height]).toEqual([20, 20]);
  });

  test("a change within the allowed share is the same", () => {
    const base = image(100, 100, [10, 20, 30]);
    const changed = image(100, 100, [10, 20, 30], [[5, 5]]);
    expect(comparePng(base, changed, { maxDiffRatio: 0.001 }).status).toBe("same");
    expect(comparePng(base, changed, { maxDiffRatio: 0 }).status).toBe("different");
  });

  test("a color that is only a little off stays under the threshold", () => {
    const base = image(10, 10, [100, 100, 100]);
    const near = image(10, 10, [101, 100, 100]);
    expect(comparePng(base, near, { maxDiffRatio: 0 }).status).toBe("same");
    const far = image(10, 10, [200, 100, 100]);
    expect(comparePng(base, far, { maxDiffRatio: 0 }).status).toBe("different");
  });

  test("another size is its own verdict, never compared pixel by pixel", () => {
    expect(comparePng(image(10, 10, [0, 0, 0]), image(10, 12, [0, 0, 0]))).toEqual({
      status: "size",
      diffPixels: 120,
    });
  });
});

/** A file system in a map, keyed by full path. */
function memory(files: Record<string, Buffer>): VisualIO & { files: Map<string, Buffer> } {
  const map = new Map(Object.entries(files));
  return {
    files: map,
    list: (dir) =>
      [...map.keys()]
        .filter((path) => path.startsWith(`${dir}/`) && path.endsWith(".png"))
        .map((path) => path.slice(dir.length + 1))
        .sort(),
    exists: (path) => map.has(path),
    read: (path) => map.get(path) as Buffer,
    write: (path, data) => void map.set(path, data),
  };
}

const GRAY = image(8, 8, [128, 128, 128]);
const OTHER = image(8, 8, [128, 128, 128], [[0, 0]]);

function check(io: VisualIO, patch: Partial<VisualCheck>): VisualCheck {
  return {
    mode: "compare",
    shotsDir: "shots",
    baselineDir: "base",
    diffDir: "shots/visual-diff",
    io,
    complete: true,
    options: { maxDiffRatio: 0 },
    ...patch,
  };
}

describe("visual: the prints of a run", () => {
  test("off and record leave the baselines alone and fail nothing", () => {
    for (const mode of ["off", "record"] as const) {
      const io = memory({ "shots/light-en/hub.png": OTHER });
      expect(checkShots(check(io, { mode }))).toEqual({ problems: [], compared: 0, updated: 0 });
      expect([...io.files.keys()]).toEqual(["shots/light-en/hub.png"]);
    }
  });

  test("update writes every print as the baseline", () => {
    const io = memory({ "shots/light-en/hub.png": GRAY, "shots/dark-pt-BR/host.png": OTHER });
    expect(checkShots(check(io, { mode: "update" }))).toEqual({
      problems: [],
      compared: 0,
      updated: 2,
    });
    expect(io.files.get("base/light-en/hub.png")).toBe(GRAY);
    expect(io.files.get("base/dark-pt-BR/host.png")).toBe(OTHER);
  });

  test("compare passes prints that match, and says nothing else", () => {
    const io = memory({ "shots/light-en/hub.png": GRAY, "base/light-en/hub.png": GRAY });
    expect(checkShots(check(io, {}))).toEqual({ problems: [], compared: 1, updated: 0 });
  });

  test("compare names each print that differs, with its pixels, and leaves the diff and the print in the diff folder", () => {
    const io = memory({ "shots/light-en/hub.png": OTHER, "base/light-en/hub.png": GRAY });
    const result = checkShots(check(io, {}));
    expect(result.compared).toBe(1);
    expect(result.problems).toEqual(["light-en/hub.png: 1 pixels differ (0.0156%)"]);
    expect(io.files.has("shots/visual-diff/light-en/hub.png")).toBe(true);
    expect(io.files.has("shots/visual-diff/light-en/hub.actual.png")).toBe(true);
    expect(io.files.has("shots/visual-diff/light-en/hub.expected.png")).toBe(true);
  });

  test("compare refuses a print with no baseline and a different size, and a baseline with no print on a full run", () => {
    const io = memory({
      "shots/light-en/new.png": GRAY,
      "shots/light-en/size.png": image(8, 9, [128, 128, 128]),
      "base/light-en/size.png": GRAY,
      "base/light-en/gone.png": GRAY,
    });
    const result = checkShots(check(io, {}));
    expect(result.problems).toEqual([
      "light-en/new.png: no baseline (record in CI, review, then commit it)",
      "light-en/size.png: the size changed (8x8 to 8x9)",
      "light-en/gone.png: a baseline with no print (a screen that went away? run with --update)",
    ]);
  });

  test("a baseline with no print is fine when only some screens were printed", () => {
    const io = memory({
      "shots/light-en/hub.png": GRAY,
      "base/light-en/hub.png": GRAY,
      "base/light-en/other.png": GRAY,
    });
    expect(checkShots(check(io, { complete: false })).problems).toEqual([]);
  });

  test("the diff folder inside the prints is not itself a print", () => {
    const io = memory({
      "shots/light-en/hub.png": GRAY,
      "base/light-en/hub.png": GRAY,
      "shots/visual-diff/light-en/hub.png": OTHER,
    });
    expect(checkShots(check(io, {})).compared).toBe(1);
  });
});
