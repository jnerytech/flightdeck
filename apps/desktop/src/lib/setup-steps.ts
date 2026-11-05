import type { DepResult } from "@flightdeck/protocol";
import type { Platform } from "../platform/types.ts";
import type { AppState } from "./app-store.ts";
import type { Route } from "./router.ts";

export type SetupStepId =
  | "host"
  | "hooks"
  | "project"
  | "session"
  | "github"
  | "notifications"
  | "budget"
  | "worktreeinclude";

/** What a host answered that the app cannot read from its own state; null: not asked or no answer. */
export interface SetupProbe {
  hooks: "installed" | "absent" | "outdated" | null;
  github: boolean | null;
}

export interface SetupStep {
  id: SetupStepId;
  /** A core step counts for the ring and, once all are done, removes the sidebar row. */
  core: boolean;
  done: boolean;
  /** Where its action goes. */
  route: Route;
}

export type SetupInput = Pick<
  AppState,
  "hosts" | "projects" | "cards" | "hub" | "budgets" | "externals"
> & {
  probes: Record<string, SetupProbe>;
  /** A test notification reached the system once. */
  notified: boolean;
};

/** The steps that apply, each done or not from the real state of the app and its hosts. */
export function setupSteps(input: SetupInput): SetupStep[] {
  void input;
  return [];
}

export interface SetupProgress {
  done: number;
  total: number;
  complete: boolean;
}

/** The core steps' progress: what the ring shows, and when the sidebar row goes away. */
export function setupProgress(steps: SetupStep[]): SetupProgress {
  void steps;
  return { done: 0, total: 0, complete: false };
}

/** The tools a host lacks, worth a quiet card: the optional ones missing, and the required ones. */
export function missingTools(deps: { items: DepResult[] } | undefined): DepResult[] {
  void deps;
  return [];
}

export const SETUP_HIDDEN_KEY = "flightdeck.setupHidden";
export const SETUP_NOTIFIED_KEY = "flightdeck.setupNotified";
export const SETUP_TOOLS_KEY = "flightdeck.setupToolsDismissed";

/** What the person chose about the checklist, kept on this computer. */
export class SetupSettings {
  hidden = true;
  notified = true;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Platform["storage"]) {
    void this.storage;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setHidden(hidden: boolean): void {
    void hidden;
  }

  /** A test notification was shown: the "turn on notifications" step is done for good. */
  markNotified(): void {}

  /** The missing tools the person dismissed, by id. */
  dismissedTools(): string[] {
    return ["?"];
  }

  dismissTool(id: string): void {
    void id;
  }
}
