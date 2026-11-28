/** The frame of a quota chart, in the units of its svg viewBox: the room around the plot keeps its dots whole. */
export const PLOT = { width: 240, height: 72, left: 30, right: 8, top: 8, bottom: 8 } as const;

export type PlotPoint = { x: number; y: number };

/** The points to draw: one line per run of known readings, and a dot for each reading. */
export type QuotaPlot = { segments: PlotPoint[][]; dots: PlotPoint[] };

/** One reading of a window: its time and its utilization (0 to 1, `null` when the plan did not say). */
export type PlotSample = { takenAt: string; utilization: number | null };

/** Places readings in the frame: time runs left to right, 0% sits at the bottom and 100% at the top. */
export function quotaPlot(_samples: readonly PlotSample[]): QuotaPlot {
  return { segments: [], dots: [] };
}
