import { memo, type ReactNode } from "react";
import { ClientChip } from "@/components/clients/client-chip";
import { StatusDot } from "@/components/status/status-dot";
import { formatAgo } from "@/i18n/format";
import type { Key, T } from "@/i18n/index";
import type { AppStore, LoopAlert, PendingItem } from "@/lib/app-store";
import type { ClientColor } from "@/lib/clients";
import type { Finish } from "@/lib/finished";
import { pendingText } from "@/lib/pending-text";
import type { WatchAlert } from "@/lib/watch-alerts";

/**
 * The rows of Needs you (#1191): one line per thing that waits for the person, its own module so
 * the list re-renders only the rows whose entry changed.
 */

/** A line of the list: a budget alert (opens Settings), a paused loop or a request (shows its card). */
export type Entry =
  | { kind: "alert"; key: string; label: string; clientId?: string }
  | { kind: "loop"; key: string; alert: LoopAlert }
  | { kind: "watch"; key: string; alert: WatchAlert }
  | { kind: "request"; key: string; item: PendingItem }
  | { kind: "finished"; key: string; finish: Finish };

// items-stretch: a button's own style is align-items: flex-start, which leaves a line no width
// to cut at (issue #175).
export const ROW_PAD = "px-2 py-1.5";
const ROW = `flex w-full min-w-0 flex-col items-stretch gap-0.5 rounded-md ${ROW_PAD} text-left transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[active=true]:bg-accent aria-pressed:bg-accent`;

/** The first line of a row: a dot, then the text. A span, since a row is a button. */
function RowHead(props: Readonly<{ children: ReactNode }>) {
  return <span className="flex items-center gap-2">{props.children}</span>;
}

/** A row of the list: a button in a list item, whatever the kind of line it holds. */
function RowButton(
  props: Readonly<{
    active: boolean;
    pressed?: boolean;
    label?: string;
    onActivate(): void;
    children: ReactNode;
  }>,
) {
  return (
    <li>
      <button
        type="button"
        {...(props.label ? { "aria-label": props.label } : {})}
        {...(props.pressed === undefined ? {} : { "aria-pressed": props.pressed })}
        data-active={props.active}
        className={ROW}
        onClick={props.onActivate}
      >
        {props.children}
      </button>
    </li>
  );
}

/** The first line of a row of a request, a loop or a watch: the dot, then its text. */
function DotLine(props: Readonly<{ t: T; text: string; children?: ReactNode }>) {
  return (
    <RowHead>
      <StatusDot tone="needs-you" label={props.t("hub.stateDots.needs_you")} />
      <span className="min-w-0 flex-1 truncate text-sm">{props.text}</span>
      {props.children}
    </RowHead>
  );
}

/** A line of the list, by the kind of entry it is. */
interface EntryRowProps {
  entry: Entry;
  /** Its place in the list: what `onActivate` is called with. */
  index: number;
  active: boolean;
  selected: boolean;
  store: AppStore;
  /** The client chip of a request's session; null for none. */
  chip: { name: string; color: ClientColor } | null;
  /** The minute of the clock: a row's "time ago" moves on with it, not on every render. */
  minute: number;
  /** The language the row speaks: it translates inside, so a switch redraws it. */
  lang: string;
  /** The name of the host of a finished session, as the list shows it now. */
  hostName: string;
  onActivate(index: number): void;
}

function EntryRowImpl(props: Readonly<EntryRowProps>) {
  const { entry, active, selected, store } = props;
  const onActivate = () => props.onActivate(props.index);
  const { t } = store.i18n;
  if (entry.kind === "alert") {
    return (
      <RowButton active={active} onActivate={onActivate}>
        <span className="truncate text-sm">{entry.label}</span>
      </RowButton>
    );
  }
  if (entry.kind === "watch") {
    const label = t("watchUi.entry", {
      card: entry.alert.title,
      reason: entry.alert.watch.reason ?? "",
    });
    return (
      <RowButton active={active} pressed={selected} label={label} onActivate={onActivate}>
        <DotLine t={t} text={label} />
      </RowButton>
    );
  }
  if (entry.kind === "loop") {
    const text = t("needsYou.loopRow", { from: entry.alert.from, to: entry.alert.to });
    return (
      <RowButton active={active} pressed={selected} onActivate={onActivate}>
        <DotLine t={t} text={text} />
      </RowButton>
    );
  }
  if (entry.kind === "finished") {
    const { finish } = entry;
    const outcome = t(`needsYou.finishedOutcome.${finish.outcome}` as Key);
    const who = `${props.hostName} · ${finish.name}`;
    return (
      <RowButton
        active={active}
        pressed={selected}
        label={`${who}: ${outcome}`}
        onActivate={onActivate}
      >
        <RowHead>
          <StatusDot tone={FINISH_TONE[finish.outcome]} label={outcome} />
          <span className="min-w-0 flex-1 truncate text-sm">{who}</span>
          <span className="shrink-0 text-muted-foreground text-xs">{outcome}</span>
          <time
            dateTime={finish.at}
            className="shrink-0 text-muted-foreground text-xs tabular-nums"
          >
            {formatAgo(store.now() - Date.parse(finish.at), t)}
          </time>
        </RowHead>
      </RowButton>
    );
  }
  const { item } = entry;
  const { chip } = props;
  // A workflow gate is not a tool: its line says which step waits (issue #175).
  const what = pendingText(item, t);
  const who = `${item.hostName} · ${item.sessionName}`;
  return (
    <RowButton active={active} pressed={selected} label={`${who}: ${what}`} onActivate={onActivate}>
      <DotLine t={t} text={who}>
        {chip && <ClientChip name={chip.name} color={chip.color} />}
        <time
          dateTime={item.createdAt}
          className="shrink-0 text-muted-foreground text-xs tabular-nums"
        >
          {formatAgo(store.now() - Date.parse(item.createdAt), t)}
        </time>
      </DotLine>
      <span className="truncate pl-5 text-muted-foreground text-xs" title={what}>
        {what}
      </span>
    </RowButton>
  );
}

const FINISH_TONE = { done: "idle", failed: "error", ended: "ended" } as const;

/** The name of a host, as the list shows it; its id when it is gone. */
export function hostNameOf(store: AppStore, hostId: string): string {
  return store.getState().hosts.find((h) => h.id === hostId)?.name ?? hostId;
}

/** What an entry shows: its own record (the request, the alert, the finish), field by field. */
function inner(entry: Entry): object {
  if (entry.kind === "request") return entry.item;
  if (entry.kind === "finished") return entry.finish;
  if (entry.kind === "alert") return entry;
  return entry.alert;
}

function shallowSame(a: object, b: object): boolean {
  const left = Object.entries(a);
  const right = b as Record<string, unknown>;
  return (
    left.length === Object.keys(b).length && left.every(([key, value]) => right[key] === value)
  );
}

/**
 * Same row, same look (#1191): the list builds its entries anew on every change of the state, so a
 * row compares what it shows, not the objects; at 200 sessions a summary redraws its own row only.
 */
function sameRow(a: Readonly<EntryRowProps>, b: Readonly<EntryRowProps>): boolean {
  return (
    a.index === b.index &&
    a.active === b.active &&
    a.selected === b.selected &&
    a.store === b.store &&
    a.minute === b.minute &&
    a.lang === b.lang &&
    a.hostName === b.hostName &&
    a.onActivate === b.onActivate &&
    a.chip?.name === b.chip?.name &&
    a.chip?.color === b.chip?.color &&
    a.entry.key === b.entry.key &&
    a.entry.kind === b.entry.kind &&
    shallowSame(inner(a.entry), inner(b.entry))
  );
}

/** A line of the list, by the kind of entry it is; redrawn only when what it shows changed. */
export const EntryRow = memo(EntryRowImpl, sameRow);
