import { SquareKanban, X } from "lucide-react";
import { Keycap } from "@/components/shortcuts/keycap";
import { type StateTone, StatusDot } from "@/components/status/status-dot";
import { Button } from "@/components/ui/button";
import type { Key, T } from "@/i18n/index";
import type { PaletteItem, PaletteSection } from "@/lib/palette";

/** How many recent entries take Alt+1… */
export const ALT_KEYS = 6;

const STATE_TONE: Record<NonNullable<PaletteItem["stateKey"]>, StateTone> = {
  running: "running",
  needs_you: "needs-you",
  idle: "idle",
};

/**
 * One section of the Ctrl+K palette (issue #147): its title, its rows (the state of a session, a
 * card's icon, the label and where it is, its key) and, past its cap, a "more" button.
 */
export function PaletteSectionView(
  props: Readonly<{
    section: PaletteSection;
    /** The rows shown now: the section's first ones, up to its cap. */
    rows: PaletteItem[];
    /** Whether a row is the one the keyboard is on. */
    selected(item: PaletteItem): boolean;
    /** How many rows are past the cap, or 0 when the more button does not show. */
    hidden: number;
    t: T;
    onChoose(item: PaletteItem): void;
    onMore(): void;
  }>,
) {
  const { section, t } = props;
  return (
    <section className="flex flex-col gap-1">
      <h3 className="px-2 font-medium text-muted-foreground text-xs">{section.title}</h3>
      <div role="listbox" aria-label={section.title} className="flex flex-col">
        {props.rows.map((item, i) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-label={item.label}
            aria-selected={props.selected(item)}
            className="palette-row flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
            onClick={() => props.onChoose(item)}
          >
            {item.stateKey && (
              <StatusDot
                tone={STATE_TONE[item.stateKey]}
                label={t(`hub.stateDots.${item.stateKey}` as Key)}
              />
            )}
            {item.id.startsWith("card:") && (
              <SquareKanban
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground"
              />
            )}
            <span className="shrink-0 whitespace-nowrap">{item.label}</span>{" "}
            <span className="min-w-0 truncate text-muted-foreground text-xs">{item.detail}</span>
            {section.recent && i < ALT_KEYS ? (
              <Keycap className="ml-auto shrink-0">{`Alt+${i + 1}`}</Keycap>
            ) : (
              item.shortcut && <Keycap className="ml-auto shrink-0">{item.shortcut}</Keycap>
            )}
          </button>
        ))}
        {props.hidden > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 justify-start px-2 text-muted-foreground text-xs"
            onClick={props.onMore}
          >
            {t("palette.more", { n: props.hidden })}
          </Button>
        )}
      </div>
    </section>
  );
}

/** A scope filter of the palette (issue #147): its kind (host or project) and its name. */
export interface PaletteChip {
  key: string;
  kind: string;
  name: string;
}

/** The palette's scope filters as chips: each one removes itself, and Clear removes them all. */
export function PaletteScopeChips(
  props: Readonly<{
    chips: PaletteChip[];
    t: T;
    onRemove(key: string): void;
    onClear(): void;
  }>,
) {
  const { t } = props;
  if (props.chips.length === 0) return null;
  return (
    <fieldset
      aria-label={t("palette.filters")}
      className="m-0 flex min-w-0 flex-wrap items-center gap-1 border-0 p-0"
    >
      {props.chips.map((chip) => (
        <Button
          key={chip.key}
          type="button"
          variant="secondary"
          size="sm"
          className="h-6 gap-1 rounded-full px-2 text-xs"
          aria-label={t("palette.removeFilter", { what: `${chip.kind} ${chip.name}` })}
          onClick={() => props.onRemove(chip.key)}
        >
          {chip.name}
          <X aria-hidden="true" className="size-3" />
        </Button>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs"
        onClick={props.onClear}
      >
        {t("palette.clearFilters")}
      </Button>
    </fieldset>
  );
}
