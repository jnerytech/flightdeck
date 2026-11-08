import { ChevronDown, type LucideIcon, X } from "lucide-react";
import { type KeyboardEvent, type ReactElement, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { T } from "@/i18n/index";
import { cn } from "@/lib/utils";
import { HostDot } from "../hosts/host-dot.tsx";

/** One tab as the list of all tabs shows it. */
export interface TabRow {
  id: string;
  title: string;
  /** The host it is on, in muted text; empty when the screen is not a host's. */
  host: string;
  /** The id of that host, for its color; absent when the screen is not a host's. */
  hostId?: string;
  icon: LucideIcon;
  kind: string;
  /** The tab on screen. */
  current: boolean;
  /** A pinned tab has no close button, as on the strip. */
  pinned: boolean;
}

/**
 * The chevron at the end of a crowded strip (#576): every tab in a list that filters as you type,
 * like VS Code's open editors. Each row shows the tab's icon, its title on one line (the whole
 * title in the tooltip), its host and a close button on hover; the tab on screen is marked. The
 * field drives it: arrows, Home, End, Enter goes to the tab, Delete closes the highlighted one
 * (only with nothing after the caret, so it never edits the text). Esc or a click outside closes it.
 */
export function TabOverflow(
  props: Readonly<{
    t: T;
    rows: readonly TabRow[];
    /** What opens the list, in place of the chevron (the narrow window's current-tab button). */
    trigger?: ReactElement;
    /** The list takes the window's width: a narrow window has no room for a card beside the tabs. */
    wide?: boolean;
    onPick(id: string): void;
    onClose(id: string): void;
  }>,
) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {props.trigger ?? (
          <Button variant="ghost" size="icon" className="tab-tool" aria-label={props.t("tabs.all")}>
            <ChevronDown />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={props.wide ? "start" : "end"}
        collisionPadding={8}
        className={cn(
          "flex max-h-[min(24rem,70vh)] flex-col gap-1 p-1",
          props.wide ? "w-[calc(100vw-1rem)]" : "w-[min(24rem,calc(100vw-2rem))]",
        )}
        data-slot="tab-overflow"
        aria-label={props.t("tabs.all")}
      >
        <TabList
          {...props}
          onPick={(id) => {
            props.onPick(id);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function TabList(
  props: Readonly<{
    t: T;
    rows: readonly TabRow[];
    onPick(id: string): void;
    onClose(id: string): void;
  }>,
) {
  const { t } = props;
  const base = useId();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? props.rows.filter((row) => `${row.title} ${row.host}`.toLowerCase().includes(needle))
    : props.rows;
  // The highlight starts on the tab on screen, and on the first match once you type.
  const [active, setActive] = useState(() => props.rows.findIndex((row) => row.current));
  const at = Math.min(active, shown.length - 1);
  const highlighted = shown[at];
  const idOf = (row: TabRow) => `${base}-${row.id}`;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = shown.length - 1;
    const field = event.currentTarget;
    const atEnd =
      field.selectionStart === field.value.length && field.selectionEnd === field.value.length;
    if (event.key === "ArrowDown") setActive(at >= last ? 0 : at + 1);
    else if (event.key === "ArrowUp") setActive(at <= 0 ? last : at - 1);
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(last);
    else if (event.key === "Enter" && highlighted) props.onPick(highlighted.id);
    else if (event.key === "Delete" && atEnd && highlighted && !highlighted.pinned)
      props.onClose(highlighted.id);
    else return;
    event.preventDefault();
  };

  return (
    <>
      <Input
        role="combobox"
        aria-label={t("tabs.filter")}
        aria-expanded={true}
        aria-controls={`${base}-list`}
        aria-autocomplete="list"
        aria-keyshortcuts="Enter Delete"
        {...(highlighted ? { "aria-activedescendant": idOf(highlighted) } : {})}
        value={query}
        placeholder={t("tabs.filter")}
        className="h-8 shrink-0"
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      {shown.length === 0 ? (
        <output className="block px-2 py-1.5 text-muted-foreground text-sm">
          {t("tabs.filterNone")}
        </output>
      ) : (
        <div
          id={`${base}-list`}
          role="listbox"
          aria-label={t("tabs.all")}
          className="min-h-0 overflow-y-auto [scrollbar-width:thin]"
        >
          {shown.map((row, index) => {
            const Icon = row.icon;
            return (
              // The wrapper is invisible to the listbox: the option and its × are siblings in it,
              // as on the strip, so no control sits inside an option (axe's nested-interactive).
              <div // NOSONAR: the wrapper only groups the option and its close button for the listbox (ARIA APG), no native element has this role
                key={row.id}
                role="presentation"
                className={cn(
                  "group relative flex h-7 items-center rounded hover:bg-accent",
                  index === at && "bg-accent text-accent-foreground",
                  // The tab on screen: a bar at its start and a heavier title, not a color alone.
                  row.current &&
                    "font-medium before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-primary",
                )}
              >
                <div
                  id={idOf(row)}
                  role="option"
                  aria-selected={index === at}
                  {...(row.current ? { "aria-current": "true" } : {})}
                  tabIndex={-1}
                  className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 text-sm"
                  onClick={() => props.onPick(row.id)}
                  onMouseMove={() => index !== at && setActive(index)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") props.onPick(row.id);
                  }}
                >
                  <Icon data-icon={row.kind} aria-hidden="true" className="size-3.5 shrink-0" />
                  <span data-slot="tab-title" title={row.title} className="min-w-0 flex-1 truncate">
                    {row.title}
                  </span>
                  {row.host && (
                    <span
                      data-slot="tab-host"
                      className="flex max-w-[40%] shrink-0 items-center gap-1 text-muted-foreground text-xs"
                    >
                      {row.hostId && <HostDot hostId={row.hostId} />}
                      <span className="truncate">{row.host}</span>
                    </span>
                  )}
                </div>
                {!row.pinned && (
                  // Out of the tab order and hidden from a screen reader, as on the strip: Delete
                  // in the field closes the highlighted row.
                  <button
                    type="button"
                    data-slot="tab-close"
                    aria-hidden="true"
                    tabIndex={-1}
                    aria-label={t("tabs.close", { title: row.title })}
                    className={cn(
                      "mr-1 flex size-5 shrink-0 items-center justify-center rounded hover:bg-background",
                      index !== at && "opacity-0 group-hover:opacity-100",
                    )}
                    onClick={() => props.onClose(row.id)}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p aria-hidden="true" className="shrink-0 px-2 pt-0.5 pb-1 text-muted-foreground text-xs">
        {t("tabs.filterHint")}
      </p>
    </>
  );
}
