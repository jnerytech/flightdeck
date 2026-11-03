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

/** The effective mode: the person's own choice, else the host's default, else full. */
export function effectiveMode(_choice: unknown, _host: HostUi | null | undefined): ModeAnswer {
  return { mode: "simple", canSwitch: false };
}

/** The person's choices, by host; anything unreadable is no choice. */
export function loadChoices(_storage: {
  getItem(key: string): string | null;
}): Record<string, UiMode> {
  return {};
}

/** Keeps one host's choice; `null` forgets it, so the host's default speaks again. */
export function saveChoice(
  _storage: { getItem(key: string): string | null; setItem(key: string, value: string): void },
  _hostId: string,
  _mode: UiMode | null,
): void {}
