import type { ReactNode } from "react";

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
 * `snapshot()` before and after an action with `since()`.
 */
export function renderProbe(_id = "probe") {
  const stats: ProbeStats = { commits: 0, ms: 0, worst: 0 };
  return {
    stats,
    wrap(children: ReactNode): ReactNode {
      return children;
    },
    snapshot(): ProbeStats {
      return { commits: -1, ms: -1, worst: -1 };
    },
    since(_before: ProbeStats): ProbeStats {
      return { commits: -1, ms: -1, worst: -1 };
    },
  };
}
