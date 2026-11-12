export type Rgb = readonly [number, number, number];

const linear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Relative luminance (0 black, 1 white) of an sRGB color. */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** A line describing a print whose background does not match its theme, or null when it does. */
export function themeProblem(theme: "light" | "dark", name: string, rgb: Rgb): string | null {
  const shows = luminance(rgb) < 0.18 ? "dark" : "light";
  return shows === theme ? null : `${name}: asked for ${theme}, the background is ${shows}`;
}
