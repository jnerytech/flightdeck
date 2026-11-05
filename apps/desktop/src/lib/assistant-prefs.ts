import {
  AssistantKind,
  AssistantProfile,
  AssistantProvider,
  DEFAULT_MODELS,
  KIND_SPECS,
  ModelId,
} from "@flightdeck/protocol";

/** Where the preferences live in `platform.storage`: one JSON value, nothing secret in it. */
export const ASSISTANT_PREFS_KEY = "flightdeck.assistant";

export interface AssistantPrefs {
  version: 1;
  /** "Show the wand": off hides every wand. */
  enabled: boolean;
  /** The provider the person chose; null until they do. */
  provider: AssistantProvider | null;
  /** The host the host provider falls back to when the field's own host cannot. */
  hostId: string | null;
  /** Hosts the person has agreed may see their text (asked once per host). */
  confirmedHosts: string[];
  models: Partial<Record<AssistantProvider, Partial<Record<AssistantProfile, string>>>>;
  profiles: Partial<Record<AssistantKind, AssistantProfile>>;
  /** OpenRouter: only providers that do not collect data. */
  openrouterPrivate: boolean;
}

export function defaultPrefs(): AssistantPrefs {
  return {
    version: 1,
    enabled: true,
    provider: null,
    hostId: null,
    confirmedHosts: [],
    models: {},
    profiles: {},
    openrouterPrivate: true,
  };
}

type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** What is stored, field by field: a value that is not ours reads as the default of that field. */
export function readPrefs(storage: Storage): AssistantPrefs {
  const prefs = defaultPrefs();
  let raw: unknown;
  try {
    raw = JSON.parse(storage.getItem(ASSISTANT_PREFS_KEY) ?? "null");
  } catch {
    return prefs;
  }
  if (!isObject(raw) || raw.version !== 1) return prefs;
  if (typeof raw.enabled === "boolean") prefs.enabled = raw.enabled;
  const provider = AssistantProvider.safeParse(raw.provider);
  if (provider.success) prefs.provider = provider.data;
  if (typeof raw.hostId === "string") prefs.hostId = raw.hostId;
  if (Array.isArray(raw.confirmedHosts)) {
    prefs.confirmedHosts = raw.confirmedHosts.filter((id): id is string => typeof id === "string");
  }
  if (isObject(raw.models)) {
    for (const name of AssistantProvider.options) {
      const stored = raw.models[name];
      if (!isObject(stored)) continue;
      for (const profile of AssistantProfile.options) {
        const id = ModelId.safeParse(stored[profile]);
        if (!id.success) continue;
        prefs.models[name] = { ...prefs.models[name], [profile]: id.data };
      }
    }
  }
  if (isObject(raw.profiles)) {
    for (const kind of AssistantKind.options) {
      const profile = AssistantProfile.safeParse(raw.profiles[kind]);
      if (profile.success) prefs.profiles[kind] = profile.data;
    }
  }
  if (typeof raw.openrouterPrivate === "boolean") prefs.openrouterPrivate = raw.openrouterPrivate;
  return prefs;
}

export function writePrefs(storage: Storage, prefs: AssistantPrefs): void {
  storage.setItem(ASSISTANT_PREFS_KEY, JSON.stringify(prefs));
}

/** The kind's own profile (quick or careful) unless the person changed it. */
export function profileFor(prefs: AssistantPrefs, kind: AssistantKind): AssistantProfile {
  return prefs.profiles[kind] ?? KIND_SPECS[kind].profile;
}

/** The chosen model for a profile, else the provider's default. */
export function modelFor(
  prefs: AssistantPrefs,
  provider: AssistantProvider,
  profile: AssistantProfile,
): string {
  return prefs.models[provider]?.[profile] ?? DEFAULT_MODELS[provider][profile];
}

export interface HostChoice {
  id: string;
  online: boolean;
  /** The host announces the `assistant` feature. */
  assistant: boolean;
}

export type ResolvedProvider =
  | { provider: "host"; hostId: string }
  | { provider: "anthropic" | "openrouter" };

/**
 * The provider a wand uses: the chosen one, else the host. The host provider runs on the field's
 * own host when it can, else on the chosen host, else on any host that can. An API provider needs
 * the shell and a saved key. When the chosen provider cannot run there is none (the wand opens
 * Settings): another provider is never used without a click.
 */
export function resolveProvider(input: {
  prefs: AssistantPrefs;
  apiSupported: boolean;
  keys: { anthropic: boolean; openrouter: boolean };
  hosts: HostChoice[];
  fieldHostId?: string;
}): ResolvedProvider | null {
  const { prefs, hosts } = input;
  const chosen = prefs.provider;
  if (chosen === "anthropic" || chosen === "openrouter") {
    return input.apiSupported && input.keys[chosen] ? { provider: chosen } : null;
  }
  const able = hosts.filter((host) => host.online && host.assistant);
  const pick =
    able.find((host) => host.id === input.fieldHostId) ??
    able.find((host) => host.id === prefs.hostId) ??
    able[0];
  return pick ? { provider: "host", hostId: pick.id } : null;
}

export function needsHostConfirm(prefs: AssistantPrefs, hostId: string): boolean {
  return !prefs.confirmedHosts.includes(hostId);
}

export function confirmHost(prefs: AssistantPrefs, hostId: string): AssistantPrefs {
  if (!needsHostConfirm(prefs, hostId)) return prefs;
  return { ...prefs, confirmedHosts: [...prefs.confirmedHosts, hostId] };
}
