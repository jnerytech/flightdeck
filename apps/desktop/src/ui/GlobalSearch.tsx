import { useState } from "react";
import type { AppState, GlobalHit } from "../lib/app-store.ts";
import { basename } from "../lib/paths.ts";

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

/** History search across every host (Ctrl+K), merged by date as each host answers. */
export function GlobalSearch(props: {
  state: AppState;
  onSearch(query: string): void;
  onClose(): void;
  onOpenHit(hit: GlobalHit): void;
}) {
  const { search, hosts } = props.state;
  const [query, setQuery] = useState(search?.query ?? "");
  const name = (id: string) => hosts.find((h) => h.id === id)?.name ?? id;
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
          placeholder="Buscar em todos os hosts (Enter)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </form>
      {search && (
        <>
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
        </>
      )}
    </dialog>
  );
}
