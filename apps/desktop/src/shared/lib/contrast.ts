/** `oklch(L C H)` or `oklch(L C H / alpha)`, L as a number or a percentage; alpha is ignored. */
function parseOklch(color: string): [number, number, number] {
  const match = /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/.exec(color);
  if (!match) throw new Error(`unsupported color: ${color}`);
  const lightness = Number(match[1]) / (match[2] ? 100 : 1);
  return [lightness, Number(match[3]), Number(match[4])];
}

/** Relative luminance (WCAG) of an oklch color, through OKLab and linear sRGB (clipped). */
function luminance(color: string): number {
  const [lightness, chroma, hue] = parseOklch(color);
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clip = (v: number) => Math.min(1, Math.max(0, v));
  const r = clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bl = clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

/** WCAG contrast ratio between two CSS colors in `oklch(L C H)` (the tokens' notation). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
