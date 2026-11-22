import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { pendingText, pendingWhere } from "@/features/needs-you/index.ts";
import { basename } from "@/shared/lib/index.ts";
import type { T } from "../../i18n/index.ts";
import { type AppState, type AppStore, needsYou, type PendingItem } from "../../lib/app-store.ts";
import { anyHostHas } from "../../lib/version.ts";
import type { GlobalHit } from "../history/index.ts";
import {
  type PaletteItem,
  type PaletteScope,
  type PaletteSection,
  type PaletteTarget,
  paletteScope,
  paletteSections,
} from "./domain/palette.ts";
import { PaletteScopeChips, PaletteSectionView } from "./palette-section.tsx";

/** Renders a daemon snippet, where every match comes wrapped in `«` and `»`. */
function Snippet({ text }: Readonly<{ text: string }>) {
  const parts = text.split(/[«»]/);
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

/** One place the arrows stop at: a row, the "more" button of a section, or a history hit. */
type Stop =
  | { id: string; kind: "item"; item: PaletteItem }
  | { id: string; kind: "more"; section: PaletteSection }
  | { id: string; kind: "hit"; hit: GlobalHit };

/**
 * The Ctrl+K palette: live sessions, cards, projects, hosts and actions filtered as you type, then
 * the history search across every host (Enter with nothing chosen), merged by date as each host
 * answers. Arrows choose (a row, a "more" button or a history hit), Enter opens it, Tab shows the
 * chosen entry's actions, or, with nothing chosen, goes on to the scope chips. The focus stays in
 * the text field: the input is a combobox over the lists and names the chosen entry.
 */
export function GlobalSearch(
  props: Readonly<{
    state: AppState;
    store: AppStore;
    /** The app has a Custos screen: "Ir para Custos" for hosts that announce `costs`. */
    costs: boolean;
    onSearch(query: string): void;
    onClose(): void;
    onOpenHit(hit: GlobalHit): void;
    onGo(target: PaletteTarget): void;
  }>,
) {
  const t = props.store.i18n.t;
  const uid = useId();
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
  const costs = props.costs && anyHostHas(hosts, "costs");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** What had the focus when the palette opened: Esc and a click outside give it back. */
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  /** Leaves without choosing anything: the focus goes back to where the person was. */
  const dismiss = () => {
    opener?.focus();
    props.onClose();
  };
  const dismissing = useRef(dismiss);
  dismissing.current = dismiss;

  useEffect(() => {
    void store.palette.load();
  }, [store]);

  useEffect(() => {
    inputRef.current?.focus();
    // The window is not modal: Esc with the focus on the page behind, or a click there, leaves too.
    const outside = (e: Event) => {
      if (!dialogRef.current?.contains(e.target as Node)) dismissing.current();
    };
    const onEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") outside(e);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

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
        globalSnippets: store.snippets.global.list(),
        recents: frozen.current ?? store.palette.recents(),
        keepRecentOrder: frozen.current !== null,
        ...oldestOf(needsYou(props.state, store.i18n.t), store.i18n.t),
        modeSwitch: modeSwitch(store),
        views: store.sessionViews.available(),
        scope,
      });
  if (frozen.current === null && !actionsOf) {
    frozen.current = sections.find((section) => section.recent)?.items.map((i) => i.id) ?? [];
  }
  const capOf = (section: PaletteSection) =>
    section.uncapped ? section.items.length : (limits[section.title] ?? SECTION_CAP);
  const shown = (section: PaletteSection) =>
    actionsOf ? section.items : section.items.slice(0, capOf(section));
  const hiddenOf = (section: PaletteSection) =>
    actionsOf ? 0 : Math.max(0, section.items.length - capOf(section));
  /** A row's place in the walk: an entry can sit in two sections (Recent and Sessions), so the section is part of it. */
  const itemStop = (section: number, id: string) => `${section}:${id}`;
  const recentItems = sections.find((section) => section.recent)?.items ?? [];
  /** The arrows' walk: each section's rows and its "more" button, then the history hits. */
  const stops: Stop[] = [
    ...sections.flatMap((section, i): Stop[] => [
      ...shown(section).map((item): Stop => ({ id: itemStop(i, item.id), kind: "item", item })),
      ...(hiddenOf(section) > 0
        ? [{ id: `more:${section.title}`, kind: "more" as const, section }]
        : []),
    ]),
    ...(actionsOf ? [] : (search?.hits ?? [])).map(
      (hit): Stop => ({
        id: `hit:${hit.hostId}/${hit.claudeSessionId}/${hit.uuid}`,
        kind: "hit",
        hit,
      }),
    ),
  ];
  /** Where the chosen entry is in the walk; -1 is the text field (or an entry that left). */
  const cursor = stops.findIndex((stop) => stop.id === activeId);
  const setCursor = (at: number) => setActiveId(stops[at]?.id ?? null);
  /** The DOM id of a stop, which the input names in `aria-activedescendant`. */
  const domId = (stopId: string) => `${uid}-${stops.findIndex((stop) => stop.id === stopId)}`;
  const activeDomId = cursor >= 0 ? domId(stops[cursor]?.id ?? "") : undefined;
  const listIds = [
    ...sections.map((_, i) => `${uid}-list-${i}`),
    ...(search && !actionsOf ? [`${uid}-hits`] : []),
  ];
  useEffect(() => {
    // The window scrolls: a chosen entry further down comes into view.
    if (activeDomId) document.getElementById(activeDomId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeDomId]);
  const back = () => {
    setActionsOf(null);
    setActiveId(null);
  };
  /**
   * What a screen reader hears as the list changes, and what a sighted person reads when it holds
   * nothing: how many rows and history hits are listed; that the text matches nothing and Enter
   * searches the history; or that the history search for this very text found nothing. A search
   * for other text is not this text's answer, so it only adds its hits to the count.
   */
  const rowCount = stops.filter((stop) => stop.kind === "item").length;
  const hitCount = search?.hits.length ?? 0;
  const typed = query.trim() !== "" && !actionsOf;
  const current = search !== null && search.query.trim() === query.trim();
  const searching = current && search.waiting.length > 0;
  const noMatch = typed && rowCount + hitCount === 0 && !current;
  const historyNone =
    typed && current && !searching && hitCount === 0 && search.silent.length === 0;
  let status = "";
  if (historyNone) status = t("searchUi.historyNone", { query: query.trim() });
  else if (noMatch) status = t("searchUi.noMatch", { query: query.trim() });
  else if (typed && !searching) status = t("searchUi.found", { n: rowCount + hitCount });

  /** Opens an entry and remembers it for the Recent section (an action of the Tab list is not one). */
  const choose = (item: PaletteItem) => {
    if (!actionsOf) store.palette.recordUse(item.id);
    props.onGo(item.target);
  };

  /** More rows of a section show (a click on its button, or Enter on it). */
  const expand = (section: PaletteSection) =>
    setLimits((before) => ({ ...before, [section.title]: capOf(section) + SECTION_MORE }));

  /** Enter on a stop: opens a row or a hit, or shows more rows and keeps the walk at the first new one. */
  const activate = (stop: Stop) => {
    if (stop.kind === "item") choose(stop.item);
    else if (stop.kind === "hit") props.onOpenHit(stop.hit);
    else {
      const next = stop.section.items[capOf(stop.section)];
      setActiveId(next ? itemStop(sections.indexOf(stop.section), next.id) : null);
      expand(stop.section);
    }
  };

  /** Tab: into the chosen entry's actions, or back from them to the list. */
  const toggleActions = (chosen: PaletteItem | undefined) => {
    if (actionsOf) back();
    else if (chosen && chosen.actions.length > 0) {
      setActionsOf(chosen);
      // The actions are their own list: its first one is chosen.
      setActiveId(itemStop(0, "action:0"));
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
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const chosen = stops[cursor];
    const alt = /^[1-6]$/.test(e.key) && e.altKey && query.trim() === "" && !actionsOf;
    if (alt) {
      // Alt+1…6 open the recent entries; nowhere outside the palette do they mean anything.
      e.preventDefault();
      const recent = recentItems[Number(e.key) - 1];
      if (recent) choose(recent);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setCursor(Math.max(-1, Math.min(stops.length - 1, cursor + step)));
    } else if (e.key === "Enter" && chosen) {
      // With nothing chosen, Enter submits the form: the history search.
      e.preventDefault();
      activate(chosen);
    } else if (e.key === "Tab") {
      // With nothing chosen, Tab goes on to the scope chips (the rows are out of the tab order).
      const leaves = chosen?.kind !== "item" && !actionsOf && !e.shiftKey && chips.length > 0;
      if (!leaves) {
        e.preventDefault();
        toggleActions(chosen?.kind === "item" ? chosen.item : undefined);
      }
    } else if (e.key === "Escape" && actionsOf) {
      // Back to the list; the dialog only closes from there.
      e.stopPropagation();
      back();
    }
  };

  return (
    <dialog
      open
      ref={dialogRef}
      className="fixed top-20 left-1/2 z-50 m-0 flex max-h-[70vh] w-[min(40rem,92vw)] -translate-x-1/2 flex-col gap-3 overflow-y-auto overflow-x-hidden rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"
      aria-label={t("searchUi.label")}
      onKeyDown={(e) => {
        if (e.key === "Escape") dismiss();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          props.onSearch(query);
        }}
      >
        <Input
          ref={inputRef}
          role="combobox"
          aria-expanded={stops.length > 0}
          aria-autocomplete="list"
          aria-controls={listIds.length > 0 ? listIds.join(" ") : undefined}
          aria-activedescendant={activeDomId}
          aria-label={t("searchUi.input")}
          aria-describedby={`${uid}-hint`}
          placeholder={t("searchUi.placeholder")}
          value={query}
          onKeyDown={onKeyDown}
          onChange={(e) => {
            setQuery(e.target.value);
            back();
          }}
        />
        <small id={`${uid}-hint`} className="text-muted-foreground text-xs">
          {t("searchUi.hint")}
        </small>
      </form>
      <output
        data-slot="palette-status"
        className={noMatch || historyNone ? "text-muted-foreground text-sm" : "sr-only"}
      >
        {status}
      </output>
      <PaletteScopeChips
        chips={chips}
        t={t}
        onRemove={removeChip}
        onClear={() => setScope({ hostId: null, projectId: null })}
      />
      {sections.map((section, i) => (
        <PaletteSectionView
          key={section.title}
          section={section}
          listId={`${uid}-list-${i}`}
          rows={shown(section)}
          idOf={(item) => domId(itemStop(i, item.id))}
          selected={(item) => stops[cursor]?.id === itemStop(i, item.id)}
          hidden={hiddenOf(section)}
          moreId={domId(`more:${section.title}`)}
          moreSelected={stops[cursor]?.id === `more:${section.title}`}
          t={t}
          onChoose={choose}
          onMore={() => expand(section)}
        />
      ))}
      {search && (
        <section className="flex flex-col gap-1">
          <h3 className="px-2 font-medium text-muted-foreground text-xs">
            {t("searchUi.history")}
          </h3>
          <output className="flex flex-col px-2 text-muted-foreground text-xs">
            {search.waiting.map((id) => (
              <span key={id}>{t("searchUi.searching", { host: name(id) })}</span>
            ))}
            {search.silent.map((id) => (
              <span key={id}>{t("searchUi.silent", { host: name(id) })}</span>
            ))}
          </output>
          <ul id={`${uid}-hits`} aria-label={t("searchUi.results")} className="flex flex-col">
            {search.hits.map((hit) => {
              const when = props.store.formatDateTime(hit.ts ?? "");
              const where = `${hit.hostName} · ${basename(hit.cwd)} · ${when}`;
              const stopId = `hit:${hit.hostId}/${hit.claudeSessionId}/${hit.uuid}`;
              return (
                <li key={`${hit.hostId}/${hit.claudeSessionId}/${hit.uuid}`}>
                  <button
                    type="button"
                    id={domId(stopId)}
                    tabIndex={-1}
                    aria-current={stops[cursor]?.id === stopId ? "true" : undefined}
                    className="palette-row flex w-full min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left"
                    onClick={() => props.onOpenHit(hit)}
                  >
                    {/* A long title or path ends in an ellipsis; the whole text is in the tooltip. */}
                    <span
                      title={`${hit.hostName} · ${hit.cwd} · ${when}`}
                      className="truncate text-muted-foreground text-xs tabular-nums"
                    >
                      {where}
                    </span>
                    <span title={hit.snippet.replaceAll(/[«»]/g, "")} className="truncate">
                      <Snippet text={hit.snippet} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </dialog>
  );
}

/** The mode the palette offers to go to, when the host in view allows a change. */
function modeSwitch(store: AppStore): "simple" | "full" | null {
  const hostId = store.uiModes.hostId();
  const now = hostId ? store.uiModes.mode(hostId) : null;
  if (!now?.canSwitch) return null;
  return now.mode === "simple" ? "full" : "simple";
}

/** The palette's line for the oldest waiting request, and whether it must be opened to be seen. */
function oldestOf(
  items: PendingItem[],
  t: T,
): { oldest?: { text: string; opens: boolean; key: string } } {
  const item = items[0];
  if (!item) return {};
  const opens = Boolean(item.gate || item.vault || item.waiting || item.risk === "high");
  return {
    oldest: {
      text: `${pendingWhere(item)}: ${pendingText(item, t)}`,
      opens,
      key: `${item.hostId}/${item.requestId}`,
    },
  };
}
