import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { colorOf, contrast, tokensOf } from "../lib/theme-contrast.ts";

const css = readFileSync(resolve(import.meta.dir, "../../apps/desktop/src/styles.css"), "utf8");

describe("theme-contrast: the helpers", () => {
  test("black and white are 21:1, equal colors 1:1, and oklch maps to sRGB", () => {
    const vars = new Map<string, string>();
    const black = colorOf("oklch(0 0 0)", vars);
    const white = colorOf("oklch(1 0 0)", vars);
    expect(black).toEqual([0, 0, 0]);
    expect(white).toEqual([255, 255, 255]);
    expect(contrast(black as never, white as never)).toBeCloseTo(21, 5);
    expect(contrast(white as never, white as never)).toBe(1);
  });

  test("var() is followed, and what is not an opaque oklch is null (the guard never guesses)", () => {
    const vars = new Map([
      ["--a", "oklch(0.5 0 0)"],
      ["--b", "var(--a)"],
      ["--c", "oklch(1 0 0 / 6%)"],
    ]);
    expect(colorOf("var(--b)", vars)).toEqual(colorOf("oklch(0.5 0 0)", vars));
    expect(colorOf("var(--c)", vars)).toBeNull();
    expect(colorOf("var(--missing)", vars)).toBeNull();
    expect(colorOf(undefined, vars)).toBeNull();
  });

  test("tokensOf reads the block of a selector", () => {
    expect(tokensOf("\n.x {\n  --a: 1;\n  --b: oklch(1 0 0);\n}\n", ".x").get("--b")).toBe(
      "oklch(1 0 0)",
    );
    expect(tokensOf(css, ".nao-existe").size).toBe(0);
  });
});

describe("theme-contrast: the dark theme's surfaces and lines (issue #98)", () => {
  const dark = tokensOf(css, ".dark");
  const vars = new Map([...tokensOf(css, ":root"), ...dark]);
  const rgb = (name: string) => {
    const color = colorOf(vars.get(name), vars);
    if (!color) throw new Error(`${name} is not an opaque oklch color: ${vars.get(name)}`);
    return color;
  };

  test("the elevation scale climbs: background < surface-1 < surface-2 < popover, each step visible", () => {
    const scale = ["--background", "--surface-1", "--surface-2", "--popover"];
    for (let i = 1; i < scale.length; i++) {
      const [lower, upper] = [scale[i - 1] as string, scale[i] as string];
      const ratio = contrast(rgb(lower), rgb(upper));
      expect([lower, upper, ratio >= 1.15]).toEqual([lower, upper, true]);
    }
    expect(vars.get("--card")).toBe("var(--surface-1)");
  });

  test("borders, inputs and dividers keep 3:1 against every surface they sit on (WCAG 1.4.11)", () => {
    for (const line of ["--border", "--input", "--sidebar-border"]) {
      for (const surface of ["--background", "--surface-1", "--surface-2", "--sidebar"]) {
        const ratio = contrast(rgb(line), rgb(surface));
        expect([line, surface, ratio >= 3]).toEqual([line, surface, true]);
      }
    }
  });

  test("the text on every surface keeps AA (4.5:1)", () => {
    for (const surface of ["--background", "--surface-1", "--surface-2", "--popover"]) {
      const ratio = contrast(rgb("--foreground"), rgb(surface));
      expect([surface, ratio >= 4.5]).toEqual([surface, true]);
      expect([surface, contrast(rgb("--muted-foreground"), rgb(surface)) >= 4.5]).toEqual([
        surface,
        true,
      ]);
    }
  });
});

describe("theme-contrast: the light theme's fields and the status colors (issue #176)", () => {
  const light = tokensOf(css, ":root");
  const dark = new Map([...light, ...tokensOf(css, ".dark")]);
  /** The ratio of two tokens, or 0 when one is not an opaque color (the guard never guesses). */
  const ratio = (vars: ReadonlyMap<string, string>, a: string, b: string) => {
    const [x, y] = [colorOf(vars.get(a), vars), colorOf(vars.get(b), vars)];
    return x && y ? contrast(x, y) : 0;
  };
  const SURFACES = ["--background", "--surface-1", "--surface-2", "--sidebar", "--popover"];

  test("a field's edge keeps 3:1 against every light surface (WCAG 1.4.11)", () => {
    for (const surface of SURFACES) {
      expect([surface, ratio(light, "--input", surface) >= 3]).toEqual([surface, true]);
    }
  });

  test("the text on every light surface keeps AA (4.5:1)", () => {
    for (const surface of SURFACES) {
      for (const text of ["--foreground", "--muted-foreground"]) {
        expect([text, surface, ratio(light, text, surface) >= 4.5]).toEqual([text, surface, true]);
      }
    }
  });

  test("every status color reads as text at AA on every surface, in both themes", () => {
    const states = ["running", "needs-you", "idle", "ended", "error", "risk"];
    for (const [theme, vars] of [
      ["light", light],
      ["dark", dark],
    ] as const) {
      for (const state of states) {
        for (const surface of ["--background", "--surface-1", "--surface-2", "--sidebar"]) {
          const ok = ratio(vars, `--status-${state}`, surface) >= 4.5;
          expect([theme, state, surface, ok]).toEqual([theme, state, surface, true]);
        }
      }
    }
  });
});

describe("theme-contrast: fields use the field token (issue #176)", () => {
  // A token test cannot see a control that draws its edge with the decorative --border: a vault
  // select did, at 1.14:1 in the light theme.
  test("every select, input and textarea that draws a border in the app's screens uses border-input", () => {
    const root = resolve(import.meta.dir, "../../apps/desktop/src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          if (!path.endsWith("components/ui")) walk(path);
        } else if (entry.name.endsWith(".tsx")) files.push(path);
      }
    };
    walk(root);
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(/<(select|input|textarea)\b[^>]*?className="([^"]*)"/gs)) {
        const classes = (m[2] as string).split(/\s+/);
        if (classes.includes("border") && !classes.includes("border-input")) {
          offenders.push(`${file.slice(root.length + 1)}: <${m[1]}>`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("theme-contrast: the chart's series colours (issue #179)", () => {
  const light = tokensOf(css, ":root");
  const dark = new Map([...light, ...tokensOf(css, ".dark")]);
  test("each series colour keeps 3:1 against the card in both themes, and the five differ", () => {
    for (const [theme, vars] of [
      ["light", light],
      ["dark", dark],
    ] as const) {
      const card = colorOf(vars.get("--card"), vars);
      const seen = new Set<string>();
      for (const n of [1, 2, 3, 4, 5]) {
        const color = colorOf(vars.get(`--chart-${n}`), vars);
        const ok = color !== null && card !== null && contrast(color, card) >= 3;
        expect([theme, n, ok]).toEqual([theme, n, true]);
        seen.add(String(color));
      }
      expect([theme, seen.size]).toEqual([theme, 5]);
    }
  });
});
