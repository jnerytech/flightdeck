import type { AssistantKind, AssistantProfile, AssistantProvider } from "@flightdeck/protocol";

export const ASSISTANT_PREFS_KEY = "flightdeck.assistant";

export interface AssistantPrefs {
  version: 1;
  enabled: boolean;
  provider: AssistantProvider | null;
  hostId: string | null;
  confirmedHosts: string[];
  models: Partial<Record<AssistantProvider, Partial<Record<AssistantProfile, string>>>>;
  profiles: Partial<Record<AssistantKind, AssistantProfile>>;
  openrouterPrivate: boolean;
}

export function defaultPrefs(): AssistantPrefs {
  return {
    version: 1,
    enabled: false,
    provider: "host",
    hostId: "",
    confirmedHosts: ["?"],
    models: { host: {} },
    profiles: {},
    openrouterPrivate: false,
  };
}

type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export function readPrefs(_storage: Storage): AssistantPrefs {
  return defaultPrefs();
}

export function writePrefs(_storage: Storage, _prefs: AssistantPrefs): void {}

export function profileFor(_prefs: AssistantPrefs, _kind: AssistantKind): AssistantProfile {
  return "quick";
}

export function modelFor(
  _prefs: AssistantPrefs,
  _provider: AssistantProvider,
  _profile: AssistantProfile,
): string {
  return "";
}

export interface HostChoice {
  id: string;
  online: boolean;
  assistant: boolean;
}

export type ResolvedProvider =
  | { provider: "host"; hostId: string }
  | { provider: "anthropic" | "openrouter" };

export function resolveProvider(_input: {
  prefs: AssistantPrefs;
  apiSupported: boolean;
  keys: { anthropic: boolean; openrouter: boolean };
  hosts: HostChoice[];
  fieldHostId?: string;
}): ResolvedProvider | null {
  return { provider: "anthropic" };
}

export function needsHostConfirm(_prefs: AssistantPrefs, _hostId: string): boolean {
  return false;
}

export function confirmHost(prefs: AssistantPrefs, _hostId: string): AssistantPrefs {
  return prefs;
}
