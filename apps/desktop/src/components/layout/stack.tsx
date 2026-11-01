import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The spacing scale: 4, 8, 12, 16, 24 and 32 px. */
export type Gap = 1 | 2 | 3 | 4 | 6 | 8;

export type Columns = 1 | 2 | 3 | 4 | 5 | 6;

/** Columns per breakpoint, from the smallest. */
export interface GridCols {
  base: Columns;
  sm?: Columns;
  md?: Columns;
  lg?: Columns;
  xl?: Columns;
}

// Whole class names, so Tailwind finds them in the source.
const GAPS: Record<Gap, string> = {
  1: "gap-1",
  2: "gap-2",
  3: "gap-3",
  4: "gap-4",
  6: "gap-6",
  8: "gap-8",
};

const COLS: Record<keyof GridCols, Record<Columns, string>> = {
  base: {
    1: "grid-cols-1",
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-4",
    5: "grid-cols-5",
    6: "grid-cols-6",
  },
  sm: {
    1: "@2xl:grid-cols-1",
    2: "@2xl:grid-cols-2",
    3: "@2xl:grid-cols-3",
    4: "@2xl:grid-cols-4",
    5: "@2xl:grid-cols-5",
    6: "@2xl:grid-cols-6",
  },
  md: {
    1: "@3xl:grid-cols-1",
    2: "@3xl:grid-cols-2",
    3: "@3xl:grid-cols-3",
    4: "@3xl:grid-cols-4",
    5: "@3xl:grid-cols-5",
    6: "@3xl:grid-cols-6",
  },
  lg: {
    1: "@5xl:grid-cols-1",
    2: "@5xl:grid-cols-2",
    3: "@5xl:grid-cols-3",
    4: "@5xl:grid-cols-4",
    5: "@5xl:grid-cols-5",
    6: "@5xl:grid-cols-6",
  },
  xl: {
    1: "@7xl:grid-cols-1",
    2: "@7xl:grid-cols-2",
    3: "@7xl:grid-cols-3",
    4: "@7xl:grid-cols-4",
    5: "@7xl:grid-cols-5",
    6: "@7xl:grid-cols-6",
  },
};

/** The element a stack or an inline row renders as: a list takes `li` children. */
export type ListTag = "div" | "ul" | "ol";

/** Vertical stack with a gap of the scale. */
export function Stack(props: {
  gap?: Gap;
  as?: ListTag;
  /** Names the stack for assistive technology (a list says what it lists). */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const Tag = props.as ?? "div";
  return (
    <Tag
      aria-label={props.label}
      className={cn("flex flex-col", GAPS[props.gap ?? 4], props.className)}
    >
      {props.children}
    </Tag>
  );
}

/** Horizontal row that wraps, with a gap of the scale. */
export function Inline(props: {
  gap?: Gap;
  as?: ListTag;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const Tag = props.as ?? "div";
  return (
    <Tag
      aria-label={props.label}
      className={cn("flex flex-row flex-wrap items-center", GAPS[props.gap ?? 2], props.className)}
    >
      {props.children}
    </Tag>
  );
}

/** Responsive grid by columns, for host cards and quota or cost panels. */
export function Grid(props: {
  cols: GridCols;
  gap?: Gap;
  className?: string;
  children: ReactNode;
}) {
  const breakpoints = Object.entries(props.cols) as Array<[keyof GridCols, Columns]>;
  return (
    <div
      className={cn(
        "grid",
        ...breakpoints.map(([breakpoint, n]) => COLS[breakpoint][n]),
        GAPS[props.gap ?? 4],
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

/** Filters and search; wraps in narrow windows. */
export function Toolbar(props: { label: string; children: ReactNode }) {
  return (
    <div role="toolbar" aria-label={props.label} className="flex flex-wrap items-center gap-2">
      {props.children}
    </div>
  );
}
