/** The frame of a quota chart, in the units of its svg viewBox: the room around the plot keeps its dots whole. */
export const PLOT = { width: 240, height: 72, left: 30, right: 8, top: 8, bottom: 8 } as const;

type PlotPoint = { x: number; y: number };

/** A dot is the point of one reading, so a screen can name it by its time. */
type PlotDot = PlotPoint & { takenAt: string };

/** The points to draw: one line per run of known readings, and a dot for each reading. */
type QuotaPlot = { segments: PlotPoint[][]; dots: PlotDot[] };

/** One reading of a window: its time and its utilization (0 to 1, `null` when the plan did not say). */
type PlotSample = { takenAt: string; utilization: number | null };

/** Places readings in the frame: time runs left to right, 0% sits at the bottom and 100% at the top. */
export function quotaPlot(samples: readonly PlotSample[]): QuotaPlot {
  const left = PLOT.left;
  const right = PLOT.width - PLOT.right;
  const top = PLOT.top;
  const bottom = PLOT.height - PLOT.bottom;
  const times = samples.map((s) => Date.parse(s.takenAt));
  const first = Math.min(...times);
  const span = Math.max(...times) - first;
  const segments: PlotPoint[][] = [];
  const dots: PlotDot[] = [];
  let run: PlotPoint[] = [];
  samples.forEach((sample, i) => {
    if (sample.utilization === null) {
      // An unknown reading is a gap in the line, not a point at 0%.
      run = [];
      return;
    }
    const x =
      span > 0
        ? left + (((times[i] as number) - first) / span) * (right - left)
        : (left + right) / 2;
    const y = bottom - Math.min(1, Math.max(0, sample.utilization)) * (bottom - top);
    const point = { x, y };
    dots.push({ ...point, takenAt: sample.takenAt });
    if (run.length === 0) segments.push(run);
    run.push(point);
  });
  return { segments, dots };
}
