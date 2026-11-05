/** The side of the taskbar overlay, in pixels. */
export const BADGE_SIZE = 32;

const RED = [217, 45, 32, 255] as const;
const WHITE = [255, 255, 255, 255] as const;

/** A 5 x 7 face for each glyph, a row to a number, the leftmost cell in the highest bit. */
const GLYPHS: Record<string, readonly number[]> = {
  "1": [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  "2": [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  "3": [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
  "4": [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  "5": [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  "6": [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  "7": [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  "8": [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  "9": [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  "+": [0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000],
};
const GLYPH_W = 5;
const GLYPH_H = 7;

/**
 * The overlay icon for `count` unread notifications as RGBA bytes (a red disc with the number in
 * white; "9+" past nine), or null for none. Drawn here, so the shell only has to hand the pixels to
 * the window and checks nothing but their size.
 */
export function badgeRgba(count: number): number[] | null {
  const whole = Math.trunc(count);
  if (!Number.isFinite(whole) || whole <= 0) return null;
  const text = whole > 9 ? "9+" : String(whole);
  // One digit is drawn large; two glyphs are smaller, so both fit inside the disc.
  const scale = text.length === 1 ? 3 : 2;
  const gap = text.length === 1 ? 0 : 2;
  const width = text.length * GLYPH_W * scale + (text.length - 1) * gap;
  const left = Math.floor((BADGE_SIZE - width) / 2);
  const top = Math.floor((BADGE_SIZE - GLYPH_H * scale) / 2);
  const rgba = new Array<number>(BADGE_SIZE * BADGE_SIZE * 4).fill(0);
  const put = (x: number, y: number, color: readonly number[]) => {
    rgba.splice((y * BADGE_SIZE + x) * 4, 4, ...color);
  };
  const center = (BADGE_SIZE - 1) / 2;
  const radius = BADGE_SIZE / 2 - 0.5;
  for (let y = 0; y < BADGE_SIZE; y++) {
    for (let x = 0; x < BADGE_SIZE; x++) {
      if (Math.hypot(x - center, y - center) <= radius) put(x, y, RED);
    }
  }
  [...text].forEach((char, index) => {
    const rows = GLYPHS[char] ?? [];
    const x0 = left + index * (GLYPH_W * scale + gap);
    rows.forEach((bits, row) => {
      for (let col = 0; col < GLYPH_W; col++) {
        if (!(bits & (1 << (GLYPH_W - 1 - col)))) continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            put(x0 + col * scale + dx, top + row * scale + dy, WHITE);
          }
        }
      }
    });
  });
  return rgba;
}
