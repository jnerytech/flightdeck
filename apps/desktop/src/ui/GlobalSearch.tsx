import { SquareKanban, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { type StateTone, StatusDot } from "@/components/status/status-dot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Key } from "../i18n/index.ts";
import { type AppState, type AppStore, type GlobalHit, needsYou } from "../lib/app-store.ts";
import {
  type PaletteItem,
  type PaletteScope,
  type PaletteSection,
  type PaletteTarget,
  paletteScope,
  paletteSections,
} from "../lib/palette.ts";
import { basename } from "../lib/paths.ts";
import { hasFeature } from "../lib/version.ts";

/** Renders a daemon snippet, where every match comes wrapped in `«` and `»`. */
export function Snippet({ text }: { text: string }) {
  const parts = text.split(/«|»/);
  // A part's position in the text is its key (parts are immutable and ordered).
  let at = 0;
  return (
    <span className="text-sm">
      {/* Odd parts sit between the markers. */}
      {parts.map((part, i) => {
        const key = at;
        at += part.length + 1;
        return i % 2 === 1 ? (
          <mark key={key} className="rounded bg-status-needs-you/30 px-0.5 text-foreground">
            {part}
          </mark>
        ) : (
          <span key={key}>{part}</span>
        );
      })}
    </span>
  );
}

/** Rows a section shows before its "more" button, and how many each press adds. */
const SECTION_CAP = 8;
const SECTION_MORE = 20;
/** How many recent entries take Alt+1… */
const ALT_KEYS = 6;

const STATE_TONE: Record<NonNullable<PaletteItem["stateKey"]>, StateTone> = {
  running: "running",
  needs_you: "needs-you",
  idle: "idle",
};

/**
 * The Ctrl+K palette: live sessions, cards, projects, hosts and actions filtered as you type, then
 * the history search across every host (Enter with nothing chosen), merged by date as each host
 * answers. Arrows choose, Enter opens, Tab shows the chosen entry's actions.
 */
export function GlobalSearch(props: {
  state: AppState;
  store: AppStore;
  /** The app has a Custos screen: "Ir para Custos" for hosts that announce `costs`. */
  costs: boolean;
  onSearch(query: string): void;
  onClose(): void;
  onOpenHit(hit: GlobalHit): void;
  onGo(target: PaletteTarget): void;
}) {
  const t = props.store.i18n.t;
  const { search, hosts } = props.state;
  const { store } = props;
  const [query, setQuery] = useState(search?.query ?? "");
  /** The chosen entry, by id: a list that updates under the cursor keeps the same item chosen. */
  const [activeId, setActiveId] = useState<string | null>(null);
  /** The entry whose actions are shown (after Tab). */
  const [actionsOf, setActionsOf] = useState<PaletteItem | null>(null);
  /** Where the person is narrows the list; the chips undo it, and closing the palette forgets it. */
  const [scope, setScope] = useState<PaletteScope>(() =>
    paletteScope(props.store.router.current, props.state),
  );
  /** The recent entries as they were when the palette opened: rows do not move under the cursor. */
  const frozen = useRef<string[] | null>(null);
  /** How many rows of each section show. */
  const [limits, setLimits] = useState<Record<string, number>>({});
  const name = (id: string) => hosts.find((h) => h.id === id)?.name ?? id;
  const costs = props.costs && hosts.some((h) => hasFeature(h.hostInfo?.features, "costs", false));

  useEffect(() => {
    void store.loadPalette();
  }, [store]);

  const sections: PaletteSection[] = actionsOf
    ? [
        {
          title: store.i18n.t("palette.actionsOf", { label: actionsOf.label }),
          items: actionsOf.actions.map((action, i) => ({
            id: `action:${i}`,
            label: action.label,
            detail: "",
            target: action.target,
            actions: [],
          })),
        },
      ]
    : paletteSections(props.state, query, {
        costs,
        t: store.i18n.t,
        globalSnippets: store.globalSnippets.list(),
        recents: frozen.current ?? store.paletteRecents(),
        keepRecentOrder: frozen.current !== null,
        waiting: needsYou(props.state).length > 0,
        scope,
      });
  if (frozen.current === null && !actionsOf) {
    frozen.current = sections.find((section) => section.recent)?.items.map((i) => i.id) ?? [];
  }
  const capOf = (section: PaletteSection) => limits[section.title] ?? SECTION_CAP;
  const shown = (section: PaletteSection) =>
    actionsOf ? section.items : section.items.slice(0, capOf(section));
  const visible = sections.flatMap(shown);
  const recentItems = sections.find((section) => section.recent)?.items ?? [];
  /** Where the chosen entry is in the visible list; -1 is the text field (or an entry that left). */
  const cursor = visible.findIndex((item) => item.id === activeId);
  const setCursor = (at: number) => setActiveId(visible[at]?.id ?? null);
  const back = () => {
    setActionsOf(null);
    setActiveId(null);
  };

  /** Opens an entry and remembers it for the Recent section (an action of the Tab list is not one). */
  const choose = (item: PaletteItem) => {
    if (!actionsOf) store.recordPaletteUse(item.id);
    props.onGo(item.target);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const chosen = visible[cursor];
    const alt = /^[1-6]$/.test(e.key) && e.altKey && query.trim() === "" && !actionsOf;
    if (alt) {
      // Alt+1…6 open the recent entries; nowhere outside the palette do they mean anything.
      e.preventDefault();
      const recent = recentItems[Number(e.key) - 1];
      if (recent) choose(recent);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setCursor(Math.max(-1, Math.min(visible.length - 1, cursor + step)));
    } else if (e.key === "Enter" && chosen) {
      // With nothing chosen, Enter submits the form: the history search.
      e.preventDefault();
      choose(chosen);
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (actionsOf) back();
      else if (chosen && chosen.actions.length > 0) {
        setActionsOf(chosen);
        // The actions are their own list: its first one is chosen.
        setActiveId("action:0");
      }
    } else if (e.key === "Escape" && actionsOf) {
      // Back to the list; the dialog only closes from there.
      e.stopPropagation();
      back();
    }
  };

  const chips = [
    ...(scope.hostId
      ? [{ key: "host", kind: t("palette.filterHost"), name: name(scope.hostId) }]
      : []),
    ...(scope.hostId && scope.projectId
      ? [
          {
            key: "project",
            kind: t("palette.filterProject"),
            name:
              props.state.projects[scope.hostId]?.find((p) => p.id === scope.projectId)?.name ??
              scope.projectId,
          },
        ]
      : []),
  ];
  const removeChip = (key: string) =>
    setScope((before) =>
      key === "host" ? { hostId: null, projectId: null } : { ...before, projectId: null },
    );
  return (
    <dialog
      open
      className="fixed top-20 left-1/2 z-50 m-0 flex max-h-[70vh] w-[min(40rem,92vw)] -translate-x-1/2 flex-col gap-3 overflow-y-auto rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"
      aria-label={t("searchUi.label")}
      onKeyDown={(e) => {
        if (e.key === "Escape") props.onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          props.onSearch(query);
        }}
      >
        <Input
          aria-label={t("searchUi.input")}
          placeholder={t("searchUi.placeholder")}
          value={query}
          onKeyDown={onKeyDown}
          onChange={(e) => {
            setQuery(e.target.value);
            back();
          }}
        />
      </form>
      {chips.length > 0 && (
        <fieldset
          aria-label={t("palette.filters")}
          className="m-0 flex min-w-0 flex-wrap items-center gap-1 border-0 p-0"
        >
          {chips.map((chip) => (
            <Button
              key={chip.key}
              type="button"
              variant="secondary"
              size="sm"
              className="h-6 gap-1 rounded-full px-2 text-xs"
              aria-label={t("palette.removeFilter", { what: `${chip.kind} ${chip.name}` })}
              onClick={() => removeChip(chip.key)}
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
            onClick={() => setScope({ hostId: null, projectId: null })}
          >
            {t("palette.clearFilters")}
          </Button>
        </fieldset>
      )}
      {sections.map((section) => (
        <section key={section.title} className="flex flex-col gap-1">
          <h3 className="px-2 font-medium text-muted-foreground text-xs">{section.title}</h3>
          <div role="listbox" aria-label={section.title} className="flex flex-col">
            {shown(section).map((item, i) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-label={item.label}
                aria-selected={visible.indexOf(item) === cursor}
                className="palette-row flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                onClick={() => choose(item)}
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
                <span>{item.label}</span>{" "}
                <span className="truncate text-muted-foreground text-xs">{item.detail}</span>
                {section.recent && i < ALT_KEYS ? (
                  <kbd className="keycap ml-auto shrink-0 bg-muted font-mono">{`Alt+${i + 1}`}</kbd>
                ) : (
                  item.shortcut && (
                    <kbd className="keycap ml-auto shrink-0 bg-muted font-mono">
                      {item.shortcut}
                    </kbd>
                  )
                )}
              </button>
            ))}
            {!actionsOf && section.items.length > capOf(section) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 justify-start px-2 text-muted-foreground text-xs"
                onClick={() =>
                  setLimits((before) => ({
                    ...before,
                    [section.title]: capOf(section) + SECTION_MORE,
                  }))
                }
              >
                {t("palette.more", { n: section.items.length - capOf(section) })}
              </Button>
            )}
          </div>
        </section>
      ))}
      {search && (
        <section className="flex flex-col gap-1">
          <h3 className="px-2 font-medium text-muted-foreground text-xs">
            {t("searchUi.history")}
          </h3>
          <ul className="flex flex-col px-2 text-muted-foreground text-xs">
            {search.waiting.map((id) => (
              <li key={id}>{t("searchUi.searching", { host: name(id) })}</li>
            ))}
            {search.silent.map((id) => (
              <li key={id}>{t("searchUi.silent", { host: name(id) })}</li>
            ))}
          </ul>
          <ul aria-label={t("searchUi.results")} className="flex flex-col">
            {search.hits.map((hit) => (
              <li key={`${hit.hostId}/${hit.claudeSessionId}/${hit.uuid}`}>
                <button
                  type="button"
                  className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                  onClick={() => props.onOpenHit(hit)}
                >
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {`${hit.hostName} · ${basename(hit.cwd)} · ${props.store.formatDateTime(hit.ts ?? "")}`}
                  </span>
                  <Snippet text={hit.snippet} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </dialog>
  );
}
