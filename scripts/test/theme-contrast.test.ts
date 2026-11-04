import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { colorOf, contrast, oklchOf, tokensOf } from "../lib/theme-contrast.ts";

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

describe("theme-contrast: warm neutrals (issue #119)", () => {
  const NEUTRALS = [
    "--background",
    "--surface-1",
    "--surface-2",
    "--popover",
    "--foreground",
    "--muted-foreground",
    "--border",
    "--input",
    "--sidebar",
    "--sidebar-border",
  ];

  test("oklchOf reads the parts of a token, through var()", () => {
    const vars = new Map([
      ["--a", "oklch(0.5 0.01 75)"],
      ["--b", "var(--a)"],
    ]);
    expect(oklchOf("var(--b)", vars)).toEqual({ l: 0.5, c: 0.01, h: 75 });
    expect(oklchOf("oklch(1 0 0 / 6%)", vars)).toBeNull();
    expect(oklchOf(undefined, vars)).toBeNull();
  });

  test("the surfaces, lines and text of both themes lean warm (hue 50 to 100) with very little chroma", () => {
    for (const selector of [":root", ".dark"]) {
      const vars = new Map([...tokensOf(css, ":root"), ...tokensOf(css, selector)]);
      for (const name of NEUTRALS) {
        const parts = oklchOf(vars.get(name), vars);
        // Light lines are translucent black: nothing to read a hue from, and nothing cool either.
        if (!parts) continue;
        const where = `${selector} ${name}`;
        expect([where, (parts.h >= 50 && parts.h <= 100) || parts.c === 0]).toEqual([where, true]);
        expect([where, parts.c <= 0.02]).toEqual([where, true]);
      }
    }
  });
});

describe("theme-contrast: the light theme's text (issue #119)", () => {
  const vars = new Map(tokensOf(css, ":root"));
  const rgb = (name: string) => {
    const color = colorOf(vars.get(name), vars);
    if (!color) throw new Error(`${name} is not an opaque oklch color: ${vars.get(name)}`);
    return color;
  };

  test("text keeps AA on every light surface, and muted text has headroom for the 80% it is drawn at", () => {
    for (const surface of ["--background", "--surface-1", "--surface-2", "--popover"]) {
      expect([surface, contrast(rgb("--foreground"), rgb(surface)) >= 4.5]).toEqual([
        surface,
        true,
      ]);
      // `text-muted-foreground/80` blends it toward the surface: 6:1 here keeps 4.5:1 there.
      expect([surface, contrast(rgb("--muted-foreground"), rgb(surface)) >= 6]).toEqual([
        surface,
        true,
      ]);
    }
  });
});
