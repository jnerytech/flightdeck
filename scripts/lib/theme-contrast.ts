/**
 * The theme tokens of `styles.css` read as colors, to check contrast without a browser. Only
 * opaque `oklch(L C H)` values (and `var(--other)` pointing at one) are understood: a token that
 * is not one comes back as `null`, so the guard fails loudly instead of passing on a guess.
 */
import type { Rgb } from "./print-theme.ts";
import { luminance } from "./print-theme.ts";

/** The `name: value` pairs of the first `selector { … }` block. */
export function tokensOf(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  const body = start < 0 ? "" : css.slice(start, css.indexOf("\n}", start));
  const found = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g))
    found.set(m[1] as string, (m[2] as string).trim());
  return found;
}

const OKLCH = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/;

const encode = (c: number): number => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
};

/** An opaque `oklch(L C H)` as sRGB, or null. `vars` resolves `var(--x)` one level at a time. */
export function colorOf(
  value: string | undefined,
  vars: ReadonlyMap<string, string>,
  depth = 0,
): Rgb | null {
  if (value === undefined || depth > 4) return null;
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  if (ref) return colorOf(vars.get(ref[1] as string), vars, depth + 1);
  const m = OKLCH.exec(value);
  if (!m) return null;
  const [l, c, h] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180];
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
  const g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
  const bl = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_;
  return [encode(r), encode(g), encode(bl)];
}

/** WCAG contrast ratio (1 to 21) of two colors. */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
