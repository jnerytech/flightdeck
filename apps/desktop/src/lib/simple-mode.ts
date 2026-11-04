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
