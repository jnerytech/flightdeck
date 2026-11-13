import { PaletteSlice } from "@/features/palette/palette-store.ts";
import { DensityController } from "@/features/shell/density.ts";
import { ShellPrefs } from "@/features/shell/shell-prefs.ts";
import { SidebarFoldController } from "@/features/shell/sidebar-fold.ts";
import { ThemeController } from "@/features/shell/theme.ts";
import { type AppUpdateSlice, wireAppUpdates } from "../../features/appupdate/index.ts";
import { WhatsNew } from "../../features/appupdate/whats-new.ts";
import { BoardWidth } from "../../features/board/index.ts";
import { DataScopeController } from "../../features/costs/index.ts";
import { HomeCache, UiModeSlice } from "../../features/home/index.ts";
import { AwayClock } from "../../features/needs-you/away.ts";
import { QuietSnoozeSlice } from "../../features/needs-you/quiet-snooze.ts";
import { NotifyPreferences } from "../../features/notifications/index.ts";
import {
  browserClockDeps,
  CacheTimerSettings,
  NewSessionPrefs,
  SharedClock,
  sessionKey,
} from "../../features/sessions/index.ts";
import { type SettingsSlice, wireSettings } from "../../features/settings/index.ts";
import { TabScopeController } from "../../features/tabs/tab-scope.ts";
import { TabOrderController } from "../../features/tabs/tab-switcher.ts";
import {
  TerminalFontController,
  TerminalReaderSetting,
} from "../../features/terminal/terminal-view.ts";
import { ViewPrefsSlice } from "../../features/viewprefs/index.ts";
import type { Platform } from "../../platform/types.ts";
import { AppLog } from "../app-log.ts";
import type { AppState, HostView } from "../app-state.ts";
import type { AppKernel } from "../kernel.ts";

/** The shell preferences: what the person set for the window and what the app keeps about itself, none of it a host's (#2376). */
export interface ShellSlices {
  /** Light, dark or the system's (phase 10). */
  readonly theme: ThemeController;
  readonly density: DensityController;
  readonly terminalFont: TerminalFontController;
  readonly terminalReader: TerminalReaderSetting;
  /** The prompt cache countdown on idle sessions: off by default (issue #159). */
  readonly cacheTimer: CacheTimerSettings;
  /** One 1-second clock for every countdown on screen. */
  readonly clock: SharedClock;
  /** How Ctrl+Tab orders the tabs (issue #148). */
  readonly tabOrder: TabOrderController;
  /** Whether the tab row shows one host's tabs or every host's (issue #644). */
  readonly tabScope: TabScopeController;
  readonly sidebarFold: SidebarFoldController;
  /** Whose data Home (and later Sessions, Costs, Board) show: every host or one (#126). */
  readonly dataScope: DataScopeController;
  /** What the shell hides: the New and Beta badges, What's new (issue #282). */
  readonly shellPrefs: ShellPrefs;
  /** What the New session form starts from: the last mode, model and folder (issue #1135). */
  readonly newSessionPrefs: NewSessionPrefs;
  /** The board columns' width, one for all, kept across starts (issue #161). */
  readonly boardWidth: BoardWidth;
  /** What the person chose about notifications: events, mutes, team folding, sound (issue #149). */
  readonly notifyPrefs: NotifyPreferences;
  /** How the person left the windows: widths, folds, hub view and filter, tile layout (#1596). */
  readonly viewPrefs: ViewPrefsSlice;
  /** Which mode the window shows, simple or full, per host (phase 33). */
  readonly uiModes: UiModeSlice;
  /** What the command palette loads and the entries it used lately (#1596). */
  readonly palette: PaletteSlice;
  /** "Not stuck" on a quiet session (`features/needs-you/quiet-snooze.ts`). */
  readonly quietSnooze: QuietSnoozeSlice;
  /** Home's last numbers per host set and period (issue #607). */
  readonly homeCache: HomeCache;
  /** Whether the release notes of an update were not opened yet (issue #125). */
  readonly whatsNew: WhatsNew;
  /** The app's own update: the check, the background download, the install and the one on quit (#1596). */
  readonly appUpdates: AppUpdateSlice;
  /** Issue #1344: when the app was last active, read before this start writes its own. */
  readonly awayClock: AwayClock;
  /** The app's log: what happens to hosts, refusals and updates goes through it (issue #255). */
  readonly appLog: AppLog;
  readonly settings: SettingsSlice;
}

type PaletteDeps = ConstructorParameters<typeof PaletteSlice>[0];

/** What the shell slices read from the rest of the store; each is read when a slice asks, so a slice built later is fine. */
interface ShellDeps {
  platform: Platform;
  /** The delay between the app's own update checks; `undefined` keeps the slice's default. */
  appUpdateIntervalMs: () => number | undefined;
  /** Changes one host's view in the state. */
  updateHost: (hostId: string, change: (host: HostView) => HostView) => void;
  /** The values the log must never write: vault values and host tokens. */
  secretValues: () => string[];
  /** A time of day in the person's language and zone. */
  formatTime: (iso: string) => string;
  /** The global search the settings shortcut opens. */
  openSearch: () => void;
  /** What the palette loads before it lists, each from its own domain. */
  palette: Pick<
    PaletteDeps,
    | "loadProjects"
    | "loadBoard"
    | "loadSshTargets"
    | "loadPersonas"
    | "listSnippets"
    | "keepSnippets"
    | "refreshHub"
  >;
}

/**
 * Builds the shell preferences. Every slice is built through its own domain's entry; the store
 * keeps only what it owns (#2376).
 */
export function composeShell(kernel: AppKernel<AppState>, deps: ShellDeps): ShellSlices {
  const { platform } = deps;
  const appLog = new AppLog({ sink: platform.logs, values: deps.secretValues });
  return {
    theme: new ThemeController(platform),
    density: new DensityController(platform.storage),
    terminalFont: new TerminalFontController(platform.storage),
    terminalReader: new TerminalReaderSetting(platform.storage),
    cacheTimer: new CacheTimerSettings(platform.storage),
    clock: new SharedClock(
      browserClockDeps(kernel.now, typeof document === "undefined" ? undefined : document),
    ),
    tabOrder: new TabOrderController(platform.storage),
    tabScope: new TabScopeController(platform.storage),
    sidebarFold: new SidebarFoldController(platform.storage),
    dataScope: new DataScopeController(platform.storage),
    shellPrefs: new ShellPrefs(platform.storage),
    newSessionPrefs: new NewSessionPrefs(platform.storage),
    boardWidth: new BoardWidth(platform.storage),
    notifyPrefs: new NotifyPreferences(platform.storage),
    viewPrefs: new ViewPrefsSlice({ storage: platform.storage }),
    uiModes: new UiModeSlice({
      hosts: () => kernel.state().hosts,
      selectedHostId: () => kernel.state().selected?.hostId ?? null,
      choices: () => kernel.state().uiChoices,
      storage: platform.storage,
      setChoices: (uiChoices) => kernel.update({ uiChoices }),
      setHostUi: (hostId, patch) =>
        kernel.hostCommand(hostId, "ui.set", { ...patch, confirm: true }),
      recordHostUi: (hostId, ui) =>
        deps.updateHost(hostId, (h) =>
          h.hostInfo ? { ...h, hostInfo: { ...h.hostInfo, ui } } : h,
        ),
    }),
    palette: new PaletteSlice({
      hosts: () => kernel.state().hosts,
      storage: platform.storage,
      ...deps.palette,
    }),
    quietSnooze: new QuietSnoozeSlice({
      snoozes: () => kernel.state().quietSnooze,
      setSnoozes: (quietSnooze) => kernel.update({ quietSnooze }),
      storage: platform.storage,
      now: () => kernel.now(),
      key: sessionKey,
      t: () => kernel.t(),
      formatTime: deps.formatTime,
      success: (text) => kernel.success(text),
    }),
    homeCache: new HomeCache(platform.storage),
    whatsNew: new WhatsNew(platform.storage),
    appUpdates: wireAppUpdates(kernel, {
      updater: () => platform.updater,
      intervalMs: deps.appUpdateIntervalMs,
      log: (level, source, message) => appLog.log(level, source, message),
      quitNow: () => platform.quitNow(),
    }),
    awayClock: new AwayClock(platform.storage, kernel.now),
    appLog,
    settings: wireSettings(kernel, { platform, onShortcut: deps.openSearch }),
  };
}
