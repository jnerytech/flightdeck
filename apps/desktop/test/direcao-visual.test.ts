import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DESKTOP = resolve(import.meta.dir, "..");
const css = readFileSync(resolve(DESKTOP, "src/styles.css"), "utf8");

/** The declarations inside the first `selector { … }` block of the stylesheet. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [
      m[1] as string,
      (m[2] as string).trim(),
    ]),
  );
}

/** Lightness of an `oklch(L C H / a)` value. */
const lightness = (value: string | undefined) => Number(/oklch\(([\d.]+)/.exec(value ?? "")?.[1]);

describe("direcao-visual", () => {
  test("Inter embutida: pacote com versão fixa, woff2 local e nenhuma URL de rede", () => {
    const pkg = JSON.parse(readFileSync(resolve(DESKTOP, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@fontsource-variable/inter"] ?? "").toMatch(/^\d+\.\d+\.\d+$/);
    expect(css).toContain('@import "@fontsource-variable/inter"');
    // The file the import points at is really there (bundled by Vite, so no network).
    const file = Bun.resolveSync(
      "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
      DESKTOP,
    );
    expect(file.endsWith(".woff2")).toBe(true);
    expect(css).not.toMatch(/https?:\/\//);
    expect(block("@theme inline")["--font-sans"]).toMatch(/^"Inter Variable"/);
    expect(block("@theme inline")["--font-mono"]).toMatch(/Cascadia Mono|Consolas/);
  });

  test("base de 13 px com a escala 12, 13, 14, 16, 20 e 24; números tabulares", () => {
    const theme = block("@theme inline");
    expect(
      ["--text-xs", "--text-sm", "--text-base", "--text-lg", "--text-xl", "--text-2xl"].map(
        (k) => theme[k],
      ),
    ).toEqual(["12px", "13px", "14px", "16px", "20px", "24px"]);
    // The body is the 13 px step.
    expect(css).toMatch(/body\s*\{[^}]*text-sm/);
    expect(css).toMatch(/\.tabular\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  });

  test("raio de 8 px nos controles e de 12 px nos painéis", () => {
    const theme = block("@theme inline");
    expect([
      theme["--radius-sm"],
      theme["--radius-md"],
      theme["--radius-lg"],
      theme["--radius-xl"],
    ]).toEqual(["6px", "8px", "12px", "12px"]);
  });

  test("superfícies em camadas: o fundo um tom abaixo dos painéis, nunca preto puro, borda com alfa", () => {
    const light = block(":root");
    const dark = block(".dark");
    expect(lightness(light["--background"])).toBeLessThan(lightness(light["--card"]));
    expect(lightness(light["--background"])).toBeGreaterThan(0.96);
    expect(lightness(dark["--background"])).toBeLessThan(lightness(dark["--card"]) - 0.02);
    // A deep gray: not pure black, not mid gray.
    expect(lightness(dark["--background"])).toBeGreaterThan(0.14);
    expect(lightness(dark["--background"])).toBeLessThan(0.22);
    expect(light["--border"]).toMatch(/\/\s*\d+%/);
    expect(dark["--border"]).toMatch(/\/\s*\d+%/);
  });

  test("uma cor de destaque só: o token brand alimenta o botão primário, o foco e o item ativo", () => {
    for (const theme of [block(":root"), block(".dark")]) {
      expect(theme["--brand"]).toMatch(/^oklch\(/);
      expect(theme["--primary"]).toBe("var(--brand)");
      expect(theme["--ring"]).toBe("var(--brand)");
      expect(theme["--sidebar-primary"]).toBe("var(--brand)");
    }
  });

  test("movimento de 120 a 180 ms com ease-out, e prefers-reduced-motion desliga", () => {
    const theme = block("@theme inline");
    expect(theme["--duration-fast"]).toBe("120ms");
    expect(theme["--duration-base"]).toBe("180ms");
    expect(theme["--ease-out-soft"]).toMatch(/^cubic-bezier\(/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*animation-duration:\s*0\.01ms/s,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*transition-duration:\s*0\.01ms/s,
    );
  });
});
