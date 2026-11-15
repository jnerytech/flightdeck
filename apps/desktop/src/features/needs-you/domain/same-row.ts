import type { ClientColor } from "@/features/clients/index.ts";
import type { LoopAlert } from "@/features/messaging";
import type { Finish } from "@/features/sessions/index.ts";
import type { WatchAlert } from "@/features/watch/index.ts";
import type { PendingItem } from "./pending-item.ts";
import type { QuietAlert } from "./quiet.ts";

/** A line of the list: a budget alert (opens Settings), a paused loop or a request (shows its card). */
export type Entry =
  | { kind: "alert"; key: string; label: string; clientId?: string }
  | { kind: "loop"; key: string; alert: LoopAlert }
  | { kind: "watch"; key: string; alert: WatchAlert }
  | { kind: "quiet"; key: string; alert: QuietAlert }
  | { kind: "request"; key: string; item: PendingItem }
  | { kind: "finished"; key: string; finish: Finish };

/** What a row shows or reacts to: the fields `sameRow` compares. */
interface RowLook {
  entry: Entry;
  index: number;
  active: boolean;
  selected: boolean;
  store: unknown;
  chip: { name: string; color: ClientColor } | null;
  minute: number;
  lang: string;
  hostName: string;
  onActivate: unknown;
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
export function sameRow(a: RowLook, b: RowLook): boolean {
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
