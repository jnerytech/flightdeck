import { Circle, CircleAlert, LoaderCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { badgePulses, type TabBadge } from "./domain/tab-badge.ts";

/** Each badge's shape: a sign besides its color (issue #172, WCAG 1.4.1). */
const BADGE_GLYPHS: Record<NonNullable<TabBadge>, { icon: LucideIcon; className: string }> = {
  "needs-you": { icon: CircleAlert, className: "text-status-needs-you" },
  running: { icon: LoaderCircle, className: "text-muted-foreground" },
  unread: { icon: Circle, className: "text-primary [&_svg]:fill-current" },
};

/**
 * A tab's badge: a glyph named in words (for screen readers and in its tooltip), never a text
 * pill, so the tab's title keeps the width.
 */
export function TabBadgeGlyph(props: Readonly<{ badge: NonNullable<TabBadge>; label: string }>) {
  const glyph = BADGE_GLYPHS[props.badge];
  const Glyph = glyph.icon;
  return (
    <span
      role="img"
      data-badge={props.badge}
      aria-label={props.label}
      title={props.label}
      className={cn(
        "tab-badge",
        glyph.className,
        badgePulses(props.badge) && "motion-safe:animate-spin",
      )}
    >
      <Glyph aria-hidden="true" className={props.badge === "unread" ? "size-2.5" : "size-3.5"} />
    </span>
  );
}
