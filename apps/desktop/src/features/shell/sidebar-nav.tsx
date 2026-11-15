import { ChevronDown, ChevronRight, type LucideProps, TriangleAlert } from "lucide-react";
import { Children, type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";
import { IconTip } from "@/shared/feedback/index.ts";
import { NAV_ICONS, type NavKey } from "./nav-icons.ts";
import { ITEM } from "./sidebar-hosts.tsx";

/** The classes of an item's icon in the bar. */
export const NAV_ICON = "size-4 shrink-0";

/** The icon of one of the screens the bar lists, the same one its tab wears. */
export function NavIcon({ name, ...props }: LucideProps & { name: NavKey }) {
  const Icon = NAV_ICONS[name];
  return <Icon {...props} />;
}

/** One line of the bar: an icon, its label (hidden in the rail, which keeps it as a tooltip) and a tail. */
export function NavButton(
  props: Readonly<{
    icon: ReactNode;
    label: string;
    /** The accessible name, when it is not the visible label. */
    name?: string;
    collapsed: boolean;
    onClick(): void;
    disabled?: boolean;
    /** A chip or badge after the label: expanded only, the rail has no room for it. */
    tail?: ReactNode;
    /** What the tail says in words (a count, a shortcut): the rail moves it to the name and the tooltip. */
    hint?: string;
    /** The keys that open this item, for assistive technology (`Control+K`). */
    keys?: string;
    /** Something waits here: the rail marks the icon with a dot instead of a badge. */
    attention?: boolean;
    /** The screen the user is on: full contrast and marked as the current page. */
    active?: boolean;
    /** Something waits here: full contrast even when it is not the open screen. */
    strong?: boolean;
    /** The item has sub-pages: a chevron at its end. */
    chevron?: boolean;
    /** A recent feature: a small badge after the label, already translated ("Beta", "New"). */
    badge?: string;
    /** The item opens a panel instead of a screen: said to assistive technology, with its state. */
    opens?: { expanded: boolean };
  }>,
) {
  const railName = props.hint ? `${props.label} (${props.hint})` : props.label;
  // A badge is announced with the name, so the label alone would read without it.
  const badgeLabel = props.badge ? props.label : undefined;
  const badgeId = useId();
  return (
    <IconTip label={props.collapsed ? railName : undefined}>
      <button
        type="button"
        aria-current={props.active ? "page" : undefined}
        aria-describedby={props.badge ? badgeId : undefined}
        aria-keyshortcuts={props.keys}
        aria-haspopup={props.opens ? "dialog" : undefined}
        aria-expanded={props.opens?.expanded}
        className={cn(
          ITEM,
          props.collapsed && "justify-center px-0",
          (props.active || props.strong) && "text-sidebar-foreground",
          props.active && "nav-active bg-sidebar-accent font-medium",
        )}
        aria-label={props.name ?? (props.collapsed ? railName : badgeLabel)}
        disabled={props.disabled ?? false}
        onClick={props.onClick}
      >
        {props.collapsed && props.attention ? (
          <span className="relative flex">
            {props.icon}
            <span
              data-attention
              aria-hidden="true"
              className="-right-0.5 -top-0.5 absolute size-2 rounded-full bg-primary"
            />
          </span>
        ) : (
          props.icon
        )}
        {!props.collapsed && <span className="min-w-0 flex-1 truncate">{props.label}</span>}
        {!props.collapsed && props.badge && (
          <span
            id={badgeId}
            data-slot="nav-badge"
            className="rounded bg-sidebar-accent px-1 font-medium text-[10px] text-sidebar-foreground/80 uppercase"
          >
            {props.badge}
          </span>
        )}
        {!props.collapsed && props.tail}
        {!props.collapsed && props.chevron && (
          <ChevronRight
            data-slot="nav-chevron"
            aria-hidden="true"
            className="size-3.5 shrink-0 text-sidebar-foreground/50"
          />
        )}
      </button>
    </IconTip>
  );
}

/**
 * A titled group of items that folds. Without items it is not drawn; in the icon rail it is only
 * a run of icons, since a heading has no room there.
 */
export function NavGroup(
  props: Readonly<{
    label: string;
    collapsed: boolean;
    folded: boolean;
    onToggle(): void;
    /** Something at the end of the title (the + of Machines). */
    action?: ReactNode;
    /** What the folded group still has to say (a host needs attention): a mark after its name. */
    attention?: string;
    children: ReactNode;
  }>,
) {
  const items = Children.toArray(props.children).filter(Boolean);
  if (items.length === 0) return null;
  if (props.collapsed) {
    return (
      <fieldset aria-label={props.label} className="sidebar-group">
        {items}
      </fieldset>
    );
  }
  return (
    <fieldset aria-label={props.label} className="sidebar-group">
      <div className="sidebar-group-head">
        <button
          type="button"
          aria-expanded={!props.folded}
          onClick={props.onToggle}
          className="sidebar-group-title"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn("size-3 transition-transform duration-150", props.folded && "-rotate-90")}
          />
          {props.label}
          {props.folded && props.attention && (
            <TriangleAlert
              role="img"
              data-slot="group-attention"
              aria-label={props.attention}
              className="size-3 text-status-needs-you"
            />
          )}
        </button>
        {props.action}
      </div>
      {!props.folded && items}
    </fieldset>
  );
}
