/** The two ways the app presents itself (phase 33). */
export type UiMode = "full" | "simple";

export const UI_CHOICES_KEY = "flightdeck.uiMode";

export interface ModeAnswer {
  mode: UiMode;
  /** Whether the app offers the switch for this host. */
  canSwitch: boolean;
}

/** What a host says about itself: its default mode and whether the switch is offered. */
export interface HostUi {
  mode?: unknown;
  locked?: unknown;
}

const asMode = (value: unknown): UiMode | null =>
  value === "full" || value === "simple" ? value : null;

/** The effective mode: the person's own choice, else the host's default, else full. */
export function effectiveMode(choice: unknown, host: HostUi | null | undefined): ModeAnswer {
  const hostMode = asMode(host?.mode) ?? "full";
  const locked = host?.locked === true;
  // A locked host's mode stands: the switch is not offered, whatever was chosen before.
  if (locked) return { mode: hostMode, canSwitch: false };
  return { mode: asMode(choice) ?? hostMode, canSwitch: true };
}

/** The person's choices, by host; anything unreadable is no choice. */
export function loadChoices(storage: {
  getItem(key: string): string | null;
}): Record<string, UiMode> {
  let stored: unknown;
  try {
    stored = JSON.parse(storage.getItem(UI_CHOICES_KEY) ?? "{}");
  } catch {
    return {};
  }
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return {};
  const choices: Record<string, UiMode> = {};
  for (const [host, value] of Object.entries(stored)) {
    const mode = asMode(value);
    if (mode) choices[host] = mode;
  }
  return choices;
}

/** Keeps one host's choice; `null` forgets it, so the host's default speaks again. */
export function saveChoice(
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void },
  hostId: string,
  mode: UiMode | null,
): void {
  const choices = loadChoices(storage);
  if (mode) choices[hostId] = mode;
  else delete choices[hostId];
  storage.setItem(UI_CHOICES_KEY, JSON.stringify(choices));
}

/** A host as the mode reads it: its status and what it says about its own mode. */
interface ModeHost {
  id: string;
  status: string;
  hostInfo?: { ui?: HostUi } | null;
}

/** A change to a host's default mode and lock. */
export interface HostUiPatch {
  mode?: UiMode;
  locked?: boolean;
}

/** What the mode reads and does through the app's store. */
export interface UiModeCore {
  hosts(): readonly ModeHost[];
  /** The host of the session on screen, if any. */
  selectedHostId(): string | null;
  choices(): Record<string, UiMode>;
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  /** Shows the person's choices, as stored now. */
  setChoices(choices: Record<string, UiMode>): void;
  /** Asks the host to change its default mode and lock (`ui.set`); null when it failed. */
  setHostUi(hostId: string, patch: HostUiPatch): Promise<Required<HostUiPatch> | null>;
  /** Records the host's answer on its view. */
  recordHostUi(hostId: string, ui: Required<HostUiPatch>): void;
}

/**
 * Which mode the window shows (#1596: a slice of the store, phase 33): the person's choice per
 * host, the host's default and lock, and the switch between simple and full.
 */
export class UiModeSlice {
  constructor(private readonly core: UiModeCore) {}

  /** The mode a host opens in: the person's choice, else the host's default, else full (phase 33). */
  mode(hostId: string): ModeAnswer {
    const host = this.core.hosts().find((h) => h.id === hostId);
    return effectiveMode(this.core.choices()[hostId], host?.hostInfo?.ui);
  }

  /** The host whose mode the window shows: the selected one, else the first that is online. */
  hostId(): string | null {
    const hosts = this.core.hosts();
    const selected = this.core.selectedHostId();
    return (
      hosts.find((h) => h.id === selected)?.id ??
      hosts.find((h) => h.status === "online")?.id ??
      null
    );
  }

  /** Switches the window between simple and full mode; false when the host is locked or none shows. */
  toggle(): boolean {
    const hostId = this.hostId();
    if (!hostId) return false;
    const now = this.mode(hostId);
    if (!now.canSwitch) return false;
    this.choose(hostId, now.mode === "simple" ? "full" : "simple");
    return true;
  }

  /** The person's choice for a host; `null` forgets it, so the host's default speaks again. */
  choose(hostId: string, mode: UiMode | null): void {
    saveChoice(this.core.storage, hostId, mode);
    this.core.setChoices(loadChoices(this.core.storage));
  }

  /** Changes the host's default mode and lock (full mode's Settings of that host). */
  async setHostUi(hostId: string, patch: HostUiPatch): Promise<boolean> {
    const ui = await this.core.setHostUi(hostId, patch);
    if (!ui) return false;
    this.core.recordHostUi(hostId, ui);
    return true;
  }
}
