import { z } from "zod";
import { readStored } from "@/shared/lib/index.ts";
import type { HubFilter, HubGroup, HubOrigin, HubRow, HubState } from "./domain/hub-row.ts";

export { isOver } from "./domain/hub-row.ts";
export { externalState, type HubRowState, hubRows } from "./domain/hub-rows.ts";
export type { HubFilter, HubGroup, HubRow, HubState };

/** Where the hub's filters are kept (not the typed text: a stale one would hide rows). */
export const HUB_FILTER_KEY = "flightdeck.hubFilter";

export const DEFAULT_HUB_FILTER: HubFilter = {
  text: "",
  origin: "",
  state: "",
  persona: "",
  pinnedOnly: false,
  showArchived: false,
};

/** The hub's kept filter, field by field: a field that is missing or unreadable falls back to its default. */
const StoredFilter = z.object({
  origin: z.enum(["", "flightdeck", "terminal", "history", "background"]).catch(""),
  state: z.enum(["", "running", "needs_you", "idle", "ended", "failed"]).catch(""),
  persona: z.string().catch(""),
  pinnedOnly: z.boolean().catch(false),
  showArchived: z.boolean().catch(false),
  /** The host kept before #126 (an older version's value that takeHubHost has not read yet). */
  host: z.string().catch(""),
});

type StoredHubFilter = z.infer<typeof StoredFilter>;

const NO_FILTER: StoredHubFilter = {
  origin: "",
  state: "",
  persona: "",
  pinnedOnly: false,
  showArchived: false,
  host: "",
};

/** The hub's kept filter as stored: a stored null, number or list is no filter. */
const storedFilter = (storage: { getItem(key: string): string | null }): StoredHubFilter =>
  readStored(storage, HUB_FILTER_KEY, StoredFilter, NO_FILTER);

/** The stored filters, field by field: anything unreadable falls back to its default. */
export function loadHubFilter(storage: { getItem(key: string): string | null }): HubFilter {
  const { host: _legacy, ...stored } = storedFilter(storage);
  return { ...stored, text: "" };
}

/** The host the hub kept in its own filter before #126, taken out of it: "" when there is none. */
export function takeHubHost(storage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}): string {
  const { host, ...rest } = storedFilter(storage);
  if (host === "") return "";
  try {
    storage.setItem(HUB_FILTER_KEY, JSON.stringify(rest));
  } catch {
    // A storage that refuses: the host is still the one to use.
  }
  return host;
}

export function saveHubFilter(
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void },
  filter: HubFilter,
): void {
  const { text: _typed, ...kept } = filter;
  // A host kept by an older version that takeHubHost has not read yet stays for it (#886).
  const { host } = storedFilter(storage);
  storage.setItem(HUB_FILTER_KEY, JSON.stringify({ ...kept, ...(host === "" ? {} : { host }) }));
}

/** How the hub draws its sessions: one line each, or one card each. */
export type HubView = "list" | "cards";

/** Where the hub's view is kept. */
export const HUB_VIEW_KEY = "flightdeck.hubView";

/** The stored view; anything unreadable is the list. */
export function loadHubView(storage: { getItem(key: string): string | null }): HubView {
  return storage.getItem(HUB_VIEW_KEY) === "cards" ? "cards" : "list";
}

export function saveHubView(
  storage: { setItem(key: string, value: string): void },
  view: HubView,
): void {
  storage.setItem(HUB_VIEW_KEY, view);
}

/** Where the open or folded state of each project is kept (issue #111). */
export const HUB_OPEN_KEY = "flightdeck.hubOpen";

/** What is kept by project: a project whose value is not a boolean is dropped, the others stay. */
const StoredOpen = z
  .record(z.string(), z.unknown())
  .transform((all) =>
    Object.fromEntries(
      Object.entries(all).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
      ),
    ),
  );

/** The projects the person opened or folded last time, by project key; anything unreadable is none. */
export function loadHubOpen(storage: {
  getItem(key: string): string | null;
}): Record<string, boolean> {
  return readStored(storage, HUB_OPEN_KEY, StoredOpen, {});
}

export function saveHubOpen(
  storage: { setItem(key: string, value: string): void },
  open: Record<string, boolean | undefined>,
): void {
  const chosen = Object.entries(open).filter(
    (entry): entry is [string, boolean] => entry[1] !== undefined,
  );
  storage.setItem(HUB_OPEN_KEY, JSON.stringify(Object.fromEntries(chosen)));
}
