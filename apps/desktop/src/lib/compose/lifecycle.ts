import { inSequence } from "@flightdeck/protocol";
import { initialAccountState } from "../../features/account/index.ts";
import type { AssistantController } from "../../features/assistant/index.ts";
import { hubHostScope } from "../../features/costs/index.ts";
import { type HostLink, initialHealthState, loadHosts } from "../../features/hosts/index.ts";
import type { InboxSlice } from "../../features/inbox/index.ts";
import { initialQuotaState } from "../../features/quota/index.ts";
import { takeHubHost } from "../../features/sessions/index.ts";
import type { I18n } from "../../i18n/index.ts";
import type { Platform } from "../../platform/types.ts";
import type { AppState } from "../app-state.ts";
import type { AppKernel } from "../kernel.ts";
import { type HostSlices, newHostView } from "./hosts.ts";
import type { ShellSlices } from "./shell.ts";
import type { VaultSlices } from "./vault.ts";

/** How often the app writes that it is still active (issue #1344). */
const AWAY_MARK_MS = 60_000;

/** The slices the start and the stop of the app reach. */
interface LifecycleSlices
  extends Pick<
      ShellSlices,
      "finished" | "theme" | "settings" | "appUpdates" | "awayClock" | "tray" | "dataScope"
    >,
    Pick<HostSlices, "hostUpdate" | "messaging">,
    Pick<VaultSlices, "vaultRules" | "backupScheduler" | "clientBudgets"> {
  readonly inbox: InboxSlice;
  readonly assistant: AssistantController;
  readonly i18n: I18n;
}

interface LifecycleDeps {
  platform: Platform;
  /** The store's slices, read when the app starts or stops. */
  slices: () => LifecycleSlices;
  /** The connections to the hosts. */
  link: () => HostLink;
  /** How often the clients' budgets are looked at. */
  clientBudgetIntervalMs: () => number | undefined;
}

/** What the store hands to the app: the start and the stop (#2376). */
export interface Lifecycle {
  init(): Promise<void>;
  dispose(): void;
}

/** Starts and stops the app's timers, listeners and host connections; the timers live here. */
export function composeLifecycle(kernel: AppKernel<AppState>, deps: LifecycleDeps): Lifecycle {
  const { platform } = deps;
  let awayTimer: ReturnType<typeof setInterval> | null = null;
  let offQuit: (() => void) | null = null;

  const dispose = (): void => {
    const s = deps.slices();
    s.messaging.dispose();
    if (awayTimer) clearInterval(awayTimer);
    awayTimer = null;
    deps.link().dispose();
    s.tray.stop();
    offQuit?.();
    offQuit = null;
    s.appUpdates.dispose();
    s.hostUpdate.dispose();
    s.backupScheduler.dispose();
    s.clientBudgets.dispose();
    s.vaultRules.dispose();
    s.theme.stop();
  };

  const init = async (): Promise<void> => {
    const s = deps.slices();
    const link = deps.link();
    s.inbox.load();
    s.finished.load();
    s.inbox.syncBadge();
    // Reset synchronously first: nothing from a previous init may stay visible while awaiting.
    dispose();
    link.listenForWake();
    s.theme.start();
    void s.assistant.refreshKeys();
    s.i18n.start();
    kernel.update({
      hosts: [],
      hostsLoaded: false,
      sessions: {},
      selected: null,
      cards: {},
      runs: {},
      ...initialQuotaState(),
      ...initialAccountState(),
      ...initialHealthState(),
    });
    await s.settings.load();
    // Client budgets are looked at every few minutes, and when a host with costs comes online.
    s.clientBudgets.start(deps.clientBudgetIntervalMs());
    s.appUpdates.start();
    // Issue #1344: the time the app is active, for the next start's "While you were away".
    s.awayClock.mark();
    if (awayTimer) clearInterval(awayTimer);
    awayTimer = setInterval(() => s.awayClock.mark(), AWAY_MARK_MS);
    // A schedule that cannot start (storage full) must not stop the app from starting.
    s.backupScheduler.start().catch(() => {});
    await s.settings.registerSaved();
    s.tray.start();
    offQuit?.();
    offQuit = platform.onQuitRequested(() => void s.appUpdates.quit());
    await inSequence(loadHosts(platform.storage), async (config) => {
      // A host added while init ran (#1718) is already listed and connecting.
      if (kernel.state().hosts.some((host) => host.id === config.id)) return;
      kernel.update({ hosts: [...kernel.state().hosts, newHostView(config)] });
      const token = await platform.secrets.get(config.id);
      if (token) link.connect(config, token);
    });
    kernel.update({ hostsLoaded: true });
    // #126 slice 2: the hub's own host filter (a name) becomes the data scope once, unless one
    // was chosen already; either way it leaves the hub, which now follows the scope.
    const hubHost = takeHubHost(platform.storage);
    if (hubHost && !s.dataScope.chosen) {
      s.dataScope.set(hubHostScope(hubHost, kernel.state().hosts));
    }
    // Last: the saved hosts must not wait for it.
    if (platform.terminal.supported) {
      kernel.update({ terminalEnv: await platform.terminal.probe() });
    }
  };

  return { init, dispose };
}
