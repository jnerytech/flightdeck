import { LIST_WIDTH_KEY, loadListWidth } from "@/shared/lib/index.ts";
import { loadLastBoards, saveLastBoard } from "../../lib/board-shortcut.ts";
import {
  type HubFilter,
  type HubView,
  loadHubFilter,
  loadHubOpen,
  loadHubView,
  saveHubFilter,
  saveHubOpen,
  saveHubView,
} from "../../lib/hub.ts";
import { loadFolded, type SidebarGroup, saveFolded } from "../../lib/sidebar-groups.ts";
import { loadTileLayout, saveTileLayout, type TileLayout } from "../../lib/tiles.ts";
import {
  loadTreeFolded,
  loadTreeOpened,
  loadTreePinned,
  saveTreeFolded,
  saveTreeOpened,
  saveTreePinned,
} from "../../lib/tree-fold.ts";

/** Where the Activity board keeps whether it shows its Idle column. */
const ACTIVITY_IDLE_KEY = "flightdeck.activityIdle";
/** Where the return on cost card's open or folded state is kept. */
const ROI_OPEN_KEY = "flightdeck.roiOpen";

/** What the view preferences read and write through the app's store: this computer's storage. */
export interface ViewPrefsCore {
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
}

/**
 * How the person left the windows, kept across starts on this computer (#1596: a slice of the
 * store): the list column's width, the folds of the sidebar and its project tree, the hub's view,
 * filter and open groups, the tile layout, the Activity board's Idle column, the return on cost
 * card and the board last opened on each host. A screen reads and writes its own piece when it
 * opens; nothing here reaches a host or renders a screen.
 */
export class ViewPrefsSlice {
  constructor(private readonly core: ViewPrefsCore) {}

  /** The list column's width (phase 10). */
  listWidth(): number {
    return loadListWidth(this.core.storage);
  }

  setListWidth(width: number): void {
    this.core.storage.setItem(LIST_WIDTH_KEY, String(width));
  }

  /** The hub's saved filters (phase 10). */
  hubFilter(): HubFilter {
    return loadHubFilter(this.core.storage);
  }

  saveHubFilter(filter: HubFilter): void {
    saveHubFilter(this.core.storage, filter);
  }

  /** The hub's groups the person opened, by group. */
  hubOpen(): Record<string, boolean> {
    return loadHubOpen(this.core.storage);
  }

  saveHubOpen(open: Record<string, boolean | undefined>): void {
    saveHubOpen(this.core.storage, open);
  }

  /** How the hub draws its sessions: lines or cards. */
  hubView(): HubView {
    return loadHubView(this.core.storage);
  }

  saveHubView(view: HubView): void {
    saveHubView(this.core.storage, view);
  }

  /** Whether the return on cost card opens unfolded (issue #178): folded unless the person opened it. */
  roiOpen(): boolean {
    return this.core.storage.getItem(ROI_OPEN_KEY) === "true";
  }

  saveRoiOpen(open: boolean): void {
    this.core.storage.setItem(ROI_OPEN_KEY, String(open));
  }

  /** The sidebar groups the user folded. */
  sidebarFolded(): SidebarGroup[] {
    return loadFolded(this.core.storage);
  }

  setSidebarFolded(folded: readonly SidebarGroup[]): void {
    saveFolded(this.core.storage, folded);
  }

  /** The projects folded in the sidebar's tree (`hostId/projectId`). */
  treeFolded(): string[] {
    return loadTreeFolded(this.core.storage);
  }

  setTreeFolded(folded: readonly string[]): void {
    saveTreeFolded(this.core.storage, folded);
  }

  /** The projects the person unfolded against the default fold. */
  treeOpened(): string[] {
    return loadTreeOpened(this.core.storage);
  }

  setTreeOpened(opened: readonly string[]): void {
    saveTreeOpened(this.core.storage, opened);
  }

  /** The projects pinned to the top of the sidebar's tree on this computer. */
  treePinned(): string[] {
    return loadTreePinned(this.core.storage);
  }

  setTreePinned(pinned: readonly string[]): void {
    saveTreePinned(this.core.storage, pinned);
  }

  /** Whether the Activity board shows its Idle column. */
  activityIdle(): boolean {
    return this.core.storage.getItem(ACTIVITY_IDLE_KEY) === "true";
  }

  setActivityIdle(on: boolean): void {
    this.core.storage.setItem(ACTIVITY_IDLE_KEY, String(on));
  }

  /** The layout of the tiles on the project page (issue #94). */
  tileLayout(): TileLayout {
    return loadTileLayout(this.core.storage);
  }

  setTileLayout(layout: TileLayout): void {
    saveTileLayout(this.core.storage, layout);
  }

  /** The board last opened on a host (#669); `null` when none. */
  lastBoard(hostId: string): string | null {
    return loadLastBoards(this.core.storage)[hostId] ?? null;
  }

  /** Keeps the board just opened on a host, for the sidebar's Board item (#669). */
  rememberBoard(hostId: string, projectId: string): void {
    saveLastBoard(this.core.storage, hostId, projectId);
  }
}
