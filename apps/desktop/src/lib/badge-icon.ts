/** The side of the taskbar overlay, in pixels. */
export const BADGE_SIZE = 32;

/** `count` draws the number in a disc; `dot` draws a small dot with no number. */
export type BadgeMode = "count" | "dot";

type Point = readonly [number, number];
type Stroke = readonly Point[];
type Segment = readonly [number, number, number, number];
type Color = readonly [number, number, number];

const RED: Color = [217, 45, 32];
const WHITE: Color = [255, 255, 255];

const MIDDLE = BADGE_SIZE / 2;
const SUPERSAMPLE = 4;
// A 26 px disc leaves a 3 px clear margin; its outer 2 px are the white ring.
const DISC_RADIUS = 13;
const RING_WIDTH = 2;
const DOT_CENTER = 24;
const DOT_RADIUS = 7;
const GLYPH_GAP = 1;

const arc = (cx: number, cy: number, rx: number, ry: number, from: number, to: number): Stroke => {
  const steps = Math.ceil(Math.abs(to - from) / 15);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    return [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)] as const;
  });
};

const curve = (from: Point, control: Point, to: Point): Stroke =>
  Array.from({ length: 13 }, (_, i) => {
    const t = i / 12;
    const a = (1 - t) ** 2;
    const b = 2 * t * (1 - t);
    const c = t ** 2;
    return [
      a * from[0] + b * control[0] + c * to[0],
      a * from[1] + b * control[1] + c * to[1],
    ] as const;
  });

const turned = (strokes: readonly Stroke[]): Stroke[] =>
  strokes.map((stroke) => stroke.map(([x, y]) => [1 - x, 1 - y] as const));

const SIX: readonly Stroke[] = [
  curve([0, 0.68], [0, 0], [0.9, 0.02]),
  arc(0.5, 0.68, 0.5, 0.32, 0, 360),
];

/** The centre line of each glyph in a unit square, the way a bold face is drawn with a pen. */
const GLYPHS: Record<string, readonly Stroke[]> = {
  "1": [
    [
      [0.05, 0.25],
      [0.6, 0],
      [0.6, 1],
    ],
  ],
  "2": [[...arc(0.5, 0.27, 0.5, 0.27, 180, 390), [0, 1], [1, 1]]],
  "3": [arc(0.5, 0.25, 0.46, 0.25, 200, 450), arc(0.5, 0.75, 0.5, 0.25, 270, 520)],
  "4": [
    [
      [0.75, 1],
      [0.75, 0],
      [0, 0.68],
      [1, 0.68],
    ],
  ],
  "5": [[[0.9, 0], [0.12, 0], [0.08, 0.45], ...arc(0.5, 0.68, 0.5, 0.32, 235, 520)]],
  "6": SIX,
  "7": [
    [
      [0, 0],
      [1, 0],
      [0.35, 1],
    ],
  ],
  "8": [arc(0.5, 0.25, 0.42, 0.25, 0, 360), arc(0.5, 0.73, 0.5, 0.27, 0, 360)],
  "9": turned(SIX),
  "+": [
    [
      [0.5, 0],
      [0.5, 1],
    ],
    [
      [0, 0.5],
      [1, 0.5],
    ],
  ],
};

/** The width and height, pen included, of one glyph. */
const glyphSize = (char: string, alone: boolean): readonly [number, number] => {
  if (char === "+") return [7, 7];
  if (alone) return [char === "1" ? 7 : 10, 15];
  return [8, 12.5];
};

/** The pen strokes of `text` as segments in picture pixels, centred in the disc. */
function digitSegments(text: string, pen: number): Segment[] {
  const alone = text.length === 1;
  const sizes = [...text].map((char) => glyphSize(char, alone));
  const total = sizes.reduce((sum, [w]) => sum + w, 0) + GLYPH_GAP * (text.length - 1);
  let left = (BADGE_SIZE - total) / 2;
  const segments: Segment[] = [];
  [...text].forEach((char, index) => {
    const [w, h] = sizes[index] ?? [0, 0];
    const top = (BADGE_SIZE - h) / 2;
    const place = ([x, y]: Point): Point => [
      left + pen / 2 + x * (w - pen),
      top + pen / 2 + y * (h - pen),
    ];
    for (const stroke of GLYPHS[char] ?? []) {
      for (let i = 1; i < stroke.length; i++) {
        const [ax, ay] = place(stroke[i - 1] as Point);
        const [bx, by] = place(stroke[i] as Point);
        segments.push([ax, ay, bx, by]);
      }
    }
    left += w + GLYPH_GAP;
  });
  return segments;
}

const touches = ([ax, ay, bx, by]: Segment, x: number, y: number, radius: number): boolean => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy) <= radius;
};

/** What lies under one point of the picture: a color, or null for clear. */
type Sampler = (x: number, y: number) => Color | null;

const countSampler = (text: string): Sampler => {
  const pen = text.length === 1 ? 3.4 : 3;
  const segments = digitSegments(text, pen);
  return (x, y) => {
    const distance = Math.hypot(x - MIDDLE, y - MIDDLE);
    if (distance > DISC_RADIUS) return null;
    if (distance >= DISC_RADIUS - RING_WIDTH) return WHITE;
    return segments.some((segment) => touches(segment, x, y, pen / 2)) ? WHITE : RED;
  };
};

const dotSampler: Sampler = (x, y) =>
  Math.hypot(x - DOT_CENTER, y - DOT_CENTER) <= DOT_RADIUS ? RED : null;

/**
 * One pixel's RGBA: the mean colour of the samples (a 4 x 4 grid) the shape covers, and the share
 * covered as alpha; null when the shape covers none of it.
 */
function pixelOf(sample: Sampler, x: number, y: number): [number, number, number, number] | null {
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  const sum = [0, 0, 0];
  let covered = 0;
  for (let i = 0; i < samples; i++) {
    const color = sample(
      x + ((i % SUPERSAMPLE) + 0.5) / SUPERSAMPLE,
      y + (Math.floor(i / SUPERSAMPLE) + 0.5) / SUPERSAMPLE,
    );
    if (color === null) continue;
    covered++;
    sum[0] = (sum[0] ?? 0) + color[0];
    sum[1] = (sum[1] ?? 0) + color[1];
    sum[2] = (sum[2] ?? 0) + color[2];
  }
  if (covered === 0) return null;
  return [
    Math.round((sum[0] ?? 0) / covered),
    Math.round((sum[1] ?? 0) / covered),
    Math.round((sum[2] ?? 0) / covered),
    Math.round((covered * 255) / samples),
  ];
}

/**
 * The overlay icon for `count` unread notifications as RGBA bytes, or null for none. By default a
 * red disc with a white ring and the number in white ("9+" past nine); in `dot` mode a small red dot
 * at the bottom-right with no number. Every pixel's alpha is the share of its 4 x 4 samples the
 * shape covers, so the edges are smooth. Drawn here, so the shell only has to hand the pixels to
 * the window and checks nothing but their size.
 */
export function badgeRgba(count: number, mode: BadgeMode = "count"): number[] | null {
  const whole = Math.trunc(count);
  if (!Number.isFinite(whole) || whole <= 0) return null;
  const sample = mode === "dot" ? dotSampler : countSampler(whole > 9 ? "9+" : String(whole));
  const rgba = new Array<number>(BADGE_SIZE * BADGE_SIZE * 4).fill(0);
  for (let y = 0; y < BADGE_SIZE; y++) {
    for (let x = 0; x < BADGE_SIZE; x++) {
      const pixel = pixelOf(sample, x, y);
      if (pixel) rgba.splice((y * BADGE_SIZE + x) * 4, 4, ...pixel);
    }
  }
  return rgba;
}
