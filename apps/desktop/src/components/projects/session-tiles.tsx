import { CornerDownLeft } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { StatusText } from "@/components/status/status-text";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Key } from "../../i18n/index.ts";
import { type AppState, type AppStore, sessionKey } from "../../lib/app-store.ts";
import { type HubRow, type HubRowState, hubRows } from "../../lib/hub.ts";
import { statusTone } from "../../lib/status.ts";
import {
  hiddenTiles,
  lastLines,
  pendingOf,
  pickTiles,
  TILE_LAYOUTS,
  type TileLayout,
  tileColumns,
} from "../../lib/tiles.ts";
import { useSessionState } from "../../lib/use-store.ts";

const MOVES: Record<string, (at: number, columns: number) => number> = {
  ArrowLeft: (at) => at - 1,
  ArrowRight: (at) => at + 1,
  ArrowUp: (at, columns) => at - columns,
  ArrowDown: (at, columns) => at + columns,
};

/** One session: its status, last lines, the request it waits on and a small message box. */
function SessionTile(
  props: Readonly<{ store: AppStore; hostId: string; row: HubRow; onOpen(): void }>,
) {
  const { store, hostId, row } = props;
  const { t } = store.i18n;
  const sessionId = row.sessionId as string;
  useEffect(() => store.watchSession(hostId, sessionId), [store, hostId, sessionId]);
  const session = useSessionState(store, sessionKey(hostId, sessionId));
  const lines = lastLines(session);
  const pending = pendingOf(session);
  const status = session.status;
  const [text, setText] = useState("");
  const caret = useRef<number | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (caret.current !== null) box.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, []);
  const send = () => {
    const value = text.trim();
    if (!value) return undefined;
    setText("");
    return store.sendTo(hostId, sessionId, value);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const at = e.currentTarget.selectionStart;
      caret.current = at + 1;
      setText(`${text.slice(0, at)}\n${text.slice(e.currentTarget.selectionEnd)}`);
    } else if (!e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };
  return (
    <section
      aria-label={row.title}
      // The tile itself takes the keyboard focus, so Alt+arrows can move from one to the next.
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a region the keyboard moves between
      tabIndex={0}
      aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown"
      data-slot="session-tile"
      className="session-tile"
    >
      <header className="session-tile-head">
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("tiles.open", { name: row.title })}
          onClick={props.onOpen}
        >
          {row.title}
        </Button>
        {status && (
          <StatusText tone={statusTone(status)}>{t(`status.${status}` as Key)}</StatusText>
        )}
      </header>
      <output aria-label={t("tiles.lines")} className="session-tile-lines">
        {lines.length > 0 ? (
          lines.map((line, at) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the lines are the tail of a text, in order
            <span key={at}>{line}</span>
          ))
        ) : (
          <span className="text-muted-foreground">{t("tiles.nothingYet")}</span>
        )}
      </output>
      {pending && (
        <fieldset aria-label={t("tiles.request")} className="session-tile-request">
          <span>{t("tiles.asks", { tool: pending.toolName })}</span>
          <ActionButton
            size="sm"
            onClick={() => store.respondTo(hostId, pending.requestId, "allow")}
          >
            {t("tiles.allow")}
          </ActionButton>
          <ActionButton
            size="sm"
            variant="outline"
            onClick={() => store.respondTo(hostId, pending.requestId, "deny")}
          >
            {t("tiles.deny")}
          </ActionButton>
        </fieldset>
      )}
      <div data-slot="composer-card" className="composer-card">
        <Textarea
          ref={box}
          aria-label={t("tiles.message", { name: row.title })}
          aria-keyshortcuts="Enter"
          placeholder={t("tiles.placeholder")}
          title={t("session.shortcuts")}
          rows={1}
          value={text}
          className="composer-box max-h-24 min-h-9 flex-1 resize-none"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {text.trim() !== "" && (
          <ActionButton
            size="icon"
            aria-label={t("tiles.send")}
            aria-keyshortcuts="Enter"
            onClick={send}
          >
            <CornerDownLeft aria-hidden="true" />
          </ActionButton>
        )}
      </div>
    </section>
  );
}

/** The grid a layout draws: boxes in rows (Auto is a box with a corner dot). */
const DRAWN: Record<TileLayout, { columns: number; rows: number }> = {
  "2": { columns: 2, rows: 1 },
  "3": { columns: 3, rows: 1 },
  "2x2": { columns: 2, rows: 2 },
  "2x3": { columns: 3, rows: 2 },
  auto: { columns: 2, rows: 2 },
};

function LayoutIcon(props: Readonly<{ layout: TileLayout }>) {
  const { columns, rows } = DRAWN[props.layout];
  const w = (16 - (columns - 1) * 2) / columns;
  const h = (12 - (rows - 1) * 2) / rows;
  return (
    <svg aria-hidden="true" viewBox="0 0 16 12" className="size-5" fill="currentColor">
      {Array.from({ length: columns * rows }, (_, i) => (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed drawing
          key={i}
          x={(i % columns) * (w + 2)}
          y={Math.floor(i / columns) * (h + 2)}
          width={w}
          height={h}
          rx="1"
          opacity={props.layout === "auto" && i > 0 ? 0.45 : 1}
        />
      ))}
    </svg>
  );
}

/** Sessions of one project side by side: 2, 3, 4 or 6 tiles, the ones that need you first. */
export function SessionTiles(
  props: Readonly<{
    store: AppStore;
    state: HubRowState;
    hostId: string;
    projectKey: string;
    /** The project's folder: a session keyed by its folder still belongs to it. */
    path?: string;
    onOpen(row: HubRow): void;
  }>,
) {
  const { store, hostId } = props;
  const { t } = store.i18n;
  const [layout, setLayout] = useState<TileLayout>(() => store.tileLayout());
  const project = {
    hostId,
    projectKey: props.projectKey,
    ...(props.path ? { path: props.path } : {}),
  };
  const all = hubRows(props.state);
  const rows = pickTiles(all, project, layout);
  const hidden = hiddenTiles(all, project, layout);
  const grid = useRef<HTMLUListElement>(null);
  if (rows.length === 0) return null;
  const columns = tileColumns(layout, rows.length);
  const move = (e: KeyboardEvent<HTMLUListElement>) => {
    const step = MOVES[e.key];
    if (!e.altKey || !step) return;
    const tiles = Array.from(
      grid.current?.querySelectorAll<HTMLElement>("[data-slot='session-tile']") ?? [],
    );
    const at = tiles.findIndex((tile) => tile.contains(e.target as Node));
    const next = tiles[step(at, columns)];
    if (at < 0 || !next) return;
    e.preventDefault();
    next.focus();
  };
  return (
    <section aria-labelledby="tiles-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="tiles-title" className="font-semibold text-base">
          {t("tiles.title")}
        </h2>
        <fieldset aria-label={t("tiles.layout")} className="tile-count">
          {TILE_LAYOUTS.map((option) => (
            <label
              key={option}
              className="tile-count-option"
              title={t(`tiles.layoutTip.${option}`)}
            >
              <input
                type="radio"
                name="tile-layout"
                aria-label={t(`tiles.layoutOption.${option}`)}
                checked={layout === option}
                onChange={() => {
                  setLayout(option);
                  store.setTileLayout(option);
                }}
              />
              <LayoutIcon layout={option} />
            </label>
          ))}
        </fieldset>
      </div>
      <p className="text-muted-foreground text-xs">
        {t("tiles.hint")}
        {hidden > 0 && (
          <span className="ms-2 font-medium">{t("tiles.notShown", { n: hidden })}</span>
        )}
      </p>
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: Alt+arrows move between the tiles inside */}
      <ul
        ref={grid}
        aria-label={t("tiles.title")}
        className="tile-grid"
        data-columns={columns}
        onKeyDown={move}
      >
        {rows.map((row) => (
          <li key={row.key} className="contents">
            <SessionTile store={store} hostId={hostId} row={row} onOpen={() => props.onOpen(row)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
