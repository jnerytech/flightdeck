import { useMediaQuery } from "./use-media-query";

/** The shell's three window widths (issue #641): compact below 640 px, medium to 1023 px, wide above. */
export type Breakpoint = "compact" | "medium" | "wide";

export const COMPACT_QUERY = "(width < 640px)";
export const MEDIUM_QUERY = "(width < 1024px)";

/** Which of the three widths the window is in now, following its resize. */
export function useBreakpoint(): Breakpoint {
  const compact = useMediaQuery(COMPACT_QUERY);
  const medium = useMediaQuery(MEDIUM_QUERY);
  if (compact) return "compact";
  return medium ? "medium" : "wide";
}
