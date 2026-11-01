import { Profiler, type ReactNode } from "react";

/** What a probe counted since it was made. */
export interface ProbeStats {
  /** React commits of the wrapped tree. */
  commits: number;
  /** Sum of the time React spent rendering the tree in those commits, in ms. */
  ms: number;
  /** The longest single commit, in ms. */
  worst: number;
}

/**
 * The render probe of the phase 28 research as a test helper: wrap the tree, then compare
 * `snapshot()` before and after an action with `since()`. It counts commits and render time with
 * React's `Profiler`, the same numbers the baseline in DECISIONS is made of.
 */
export function renderProbe(id = "probe") {
  const stats: ProbeStats = { commits: 0, ms: 0, worst: 0 };
  return {
    stats,
    wrap(children: ReactNode): ReactNode {
      return (
        <Profiler
          id={id}
          onRender={(_id, _phase, actualDuration) => {
            stats.commits += 1;
            stats.ms += actualDuration;
            stats.worst = Math.max(stats.worst, actualDuration);
          }}
        >
          {children}
        </Profiler>
      );
    },
    snapshot(): ProbeStats {
      return { ...stats };
    },
    /** What was counted after `before` was taken; `worst` is the longest commit since the probe was made. */
    since(before: ProbeStats): ProbeStats {
      return {
        commits: stats.commits - before.commits,
        ms: stats.ms - before.ms,
        worst: stats.worst,
      };
    },
  };
}
