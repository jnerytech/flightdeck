import { type KeyboardEvent, useEffect, useState } from "react";
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
  return (
    <span className="snippet">
      {/* Odd parts sit between the markers. */}
      {parts.map((part, i) =>
        // biome-ignore lint/suspicious/noArrayIndexKey: parts are immutable and ordered
        i % 2 === 1 ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>,
      )}
    </span>
  );
}

/** `YYYY-MM-DD HH:MM` of an ISO timestamp (as stored, UTC). */
export const when = (ts: string | null) => (ts ? ts.slice(0, 16).replace("T", " ") : "");

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
          title: `Ações de ${actionsOf.label}`,
          items: actionsOf.actions.map((action, i) => ({
            id: `action:${i}`,
            label: action.label,
            detail: "",
            target: action.target,
            actions: [],
          })),
        },
      ]
    : paletteSections(props.state, query, { costs });
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
      className="global-search"
      aria-label="Busca global"
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
        <input
          aria-label="Buscar no histórico"
          placeholder="Sessões, cards, projetos, ações… (Enter busca no histórico)"
          value={query}
          onKeyDown={onKeyDown}
          onChange={(e) => {
            setQuery(e.target.value);
            back();
          }}
        />
      </form>
      {sections.map((section) => (
        <section key={section.title} className="palette-section">
          <h3>{section.title}</h3>
          <div role="listbox" aria-label={section.title} className="palette-list">
            {section.items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-label={item.label}
                aria-selected={visible.indexOf(item) === cursor}
                onClick={() => props.onGo(item.target)}
              >
                <span>{item.label}</span> <span className="muted">{item.detail}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
      {search && (
        <section className="palette-section">
          <h3>Histórico</h3>
          <ul className="search-status">
            {search.waiting.map((id) => (
              <li key={id} className="muted">{`${name(id)}: buscando…`}</li>
            ))}
            {search.silent.map((id) => (
              <li key={id} className="muted">{`${name(id)}: sem resposta`}</li>
            ))}
          </ul>
          <ul aria-label="Resultados da busca">
            {search.hits.map((hit) => (
              <li key={`${hit.hostId}/${hit.claudeSessionId}/${hit.uuid}`}>
                <button type="button" onClick={() => props.onOpenHit(hit)}>
                  <span className="muted">
                    {`${hit.hostName} · ${basename(hit.cwd)} · ${when(hit.ts)}`}
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
