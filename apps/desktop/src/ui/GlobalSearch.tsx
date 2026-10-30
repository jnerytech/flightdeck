import { type KeyboardEvent, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import type { AppState, AppStore, GlobalHit } from "../lib/app-store.ts";
import {
  type PaletteItem,
  type PaletteSection,
  type PaletteTarget,
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
  /** Index of the chosen entry in the visible list; -1 is the text field. */
  const [cursor, setCursor] = useState(-1);
  /** The entry whose actions are shown (after Tab). */
  const [actionsOf, setActionsOf] = useState<PaletteItem | null>(null);
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
      });
  const visible = sections.flatMap((section) => section.items);
  const back = () => {
    setActionsOf(null);
    setCursor(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const chosen = visible[cursor];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setCursor(Math.max(-1, Math.min(visible.length - 1, cursor + step)));
    } else if (e.key === "Enter" && chosen) {
      // With nothing chosen, Enter submits the form: the history search.
      e.preventDefault();
      props.onGo(chosen.target);
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (actionsOf) back();
      else if (chosen && chosen.actions.length > 0) {
        setActionsOf(chosen);
        setCursor(0);
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
      {sections.map((section) => (
        <section key={section.title} className="flex flex-col gap-1">
          <h3 className="px-2 font-medium text-muted-foreground text-xs">{section.title}</h3>
          <div role="listbox" aria-label={section.title} className="flex flex-col">
            {section.items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-label={item.label}
                aria-selected={visible.indexOf(item) === cursor}
                className="flex items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent aria-selected:bg-accent"
                onClick={() => props.onGo(item.target)}
              >
                <span>{item.label}</span>{" "}
                <span className="truncate text-muted-foreground text-xs">{item.detail}</span>
              </button>
            ))}
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
