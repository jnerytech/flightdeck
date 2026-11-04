export type Rgb = readonly [number, number, number];

/** Relative luminance (0 black, 1 white) of an sRGB color. */
export function luminance(rgb: Rgb): number {
  return 0.5;
}

/** A line describing a print whose background does not match its theme, or null when it does. */
export function themeProblem(theme: "light" | "dark", name: string, rgb: Rgb): string | null {
  return null;
}
