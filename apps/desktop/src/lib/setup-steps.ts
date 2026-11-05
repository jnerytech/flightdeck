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

const online = (hosts: SetupInput["hosts"]) => hosts.filter((h) => h.status === "online");

/** A step needs a feature: kept while no host is online to say (it is still to do), else when one announces it. */
const announced = (hosts: SetupInput["hosts"], feature: string) => {
  const here = online(hosts);
  return here.length === 0 || here.some((h) => h.hostInfo?.features?.includes(feature));
};

/** The steps that apply, each done or not from the real state of the app and its hosts. */
export function setupSteps(input: SetupInput): SetupStep[] {
  const here = online(input.hosts);
  const first = here[0];
  const projects = here.flatMap((h) => input.projects[h.id] ?? []);
  const withFeature = (feature: string) =>
    here.find((h) => h.hostInfo?.features?.includes(feature)) ?? first;
  // Where an action goes when it needs a host: the first that can do it, else the page that adds one.
  const toHost = (route: (hostId: string) => Route, feature?: string): Route => {
    const target = feature ? withFeature(feature) : first;
    return target ? route(target.id) : { name: "add-host" };
  };
  const hasSession = here.some(
    (h) =>
      h.sessions.length > 0 ||
      (input.hub[h.id]?.managed.length ?? 0) > 0 ||
      (input.hub[h.id]?.history.length ?? 0) > 0 ||
      Object.keys(input.externals).some((key) => key.startsWith(`${h.id}/`)) ||
      Object.entries(input.cards).some(
        ([key, card]) => key.startsWith(`${h.id}/`) && card.sessionId,
      ),
  );
  const steps: Array<SetupStep | null> = [
    { id: "host", core: true, done: here.length > 0, route: { name: "add-host" } },
    announced(input.hosts, "central")
      ? {
          id: "hooks",
          core: true,
          done: here.some((h) => input.probes[h.id]?.hooks === "installed"),
          route: toHost((host) => ({ name: "host", host }), "central"),
        }
      : null,
    announced(input.hosts, "workflows")
      ? {
          id: "project",
          core: true,
          done: projects.some((p) => p.baseBranch !== ""),
          route: toHost((host) => ({ name: "projects", host }), "workflows"),
        }
      : null,
    {
      id: "session",
      core: true,
      done: hasSession,
      route: toHost((host) => ({ name: "new-session", host })),
    },
    announced(input.hosts, "github")
      ? {
          id: "github",
          core: false,
          done: here.some((h) => input.probes[h.id]?.github === true),
          route: toHost((host) => ({ name: "host", host }), "github"),
        }
      : null,
    { id: "notifications", core: false, done: input.notified, route: { name: "settings" } },
    announced(input.hosts, "costs")
      ? {
          id: "budget",
          core: false,
          done: here.some((h) => (input.budgets[h.id]?.length ?? 0) > 0),
          route: { name: "settings" },
        }
      : null,
    projects.length > 0
      ? {
          id: "worktreeinclude",
          core: false,
          done: projects.some((p) => p.worktreeInclude === true),
          route: toHost((host) => ({ name: "projects", host })),
        }
      : null,
  ];
  return steps.filter((step): step is SetupStep => step !== null);
}

export interface SetupProgress {
  done: number;
  total: number;
  complete: boolean;
}

/** The core steps' progress: what the ring shows, and when the sidebar row goes away. */
export function setupProgress(steps: SetupStep[]): SetupProgress {
  const core = steps.filter((step) => step.core);
  const done = core.filter((step) => step.done).length;
  return { done, total: core.length, complete: core.length > 0 && done === core.length };
}

/** The tools a host lacks, worth a quiet card: the required ones first, then the optional. */
export function missingTools(deps: { items: DepResult[] } | undefined): DepResult[] {
  const missing = (deps?.items ?? []).filter((d) => d.state === "missing");
  return [
    ...missing.filter((d) => d.group === "required"),
    ...missing.filter((d) => d.group !== "required"),
  ];
}

export const SETUP_HIDDEN_KEY = "flightdeck.setupHidden";
export const SETUP_NOTIFIED_KEY = "flightdeck.setupNotified";
export const SETUP_TOOLS_KEY = "flightdeck.setupToolsDismissed";

/** What the person chose about the checklist, kept on this computer. */
export class SetupSettings {
  hidden: boolean;
  notified: boolean;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Platform["storage"]) {
    this.hidden = storage.getItem(SETUP_HIDDEN_KEY) === "on";
    this.notified = storage.getItem(SETUP_NOTIFIED_KEY) === "on";
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.storage.setItem(SETUP_HIDDEN_KEY, hidden ? "on" : "off");
    this.emit();
  }

  /** A test notification was shown: the "check that notifications work" step is done for good. */
  markNotified(): void {
    this.notified = true;
    this.storage.setItem(SETUP_NOTIFIED_KEY, "on");
    this.emit();
  }

  /** The missing tools the person dismissed, as `tool@host`. */
  dismissedTools(): string[] {
    try {
      const stored: unknown = JSON.parse(this.storage.getItem(SETUP_TOOLS_KEY) ?? "[]");
      return Array.isArray(stored)
        ? stored.filter((id): id is string => typeof id === "string")
        : [];
    } catch {
      return [];
    }
  }

  dismissTool(id: string): void {
    const kept = this.dismissedTools();
    if (!kept.includes(id)) this.storage.setItem(SETUP_TOOLS_KEY, JSON.stringify([...kept, id]));
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
