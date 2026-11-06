import { describe, expect, test } from "bun:test";
import { DEFAULT_MODELS, KIND_SPECS } from "@flightdeck/protocol";
import {
  ASSISTANT_PREFS_KEY,
  type AssistantPrefs,
  confirmHost,
  defaultPrefs,
  modelFor,
  needsHostConfirm,
  profileFor,
  readPrefs,
  resolveProvider,
  writePrefs,
} from "../src/lib/assistant-prefs.ts";

function storage(initial?: string) {
  const items = new Map<string, string>(
    initial === undefined ? [] : [[ASSISTANT_PREFS_KEY, initial]],
  );
  return {
    items,
    api: {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
    },
  };
}
const host = (id: string, online = true, assistant = true) => ({ id, online, assistant });

describe("assistant-prefs: what is kept, and nothing secret", () => {
  test("the defaults: the wand on, no provider chosen, no model chosen, no host confirmed", () => {
    expect(defaultPrefs()).toEqual({
      version: 1,
      enabled: true,
      provider: null,
      hostId: null,
      confirmedHosts: [],
      models: {},
      profiles: {},
      openrouterPrivate: true,
    });
    expect(readPrefs(storage().api)).toEqual(defaultPrefs());
  });

  test("they are written as one JSON value under flightdeck.assistant and read back", () => {
    const { api, items } = storage();
    const prefs: AssistantPrefs = {
      ...defaultPrefs(),
      provider: "openrouter",
      enabled: false,
      models: { openrouter: { quick: "meta/llama" } },
      profiles: { "team.goal": "careful" },
    };
    writePrefs(api, prefs);
    expect(JSON.parse(items.get("flightdeck.assistant") ?? "null")).toEqual(prefs);
    expect(readPrefs(api)).toEqual(prefs);
  });

  test("a stored value that is not ours (garbage, another version, wrong types) reads as the defaults, field by field", () => {
    expect(readPrefs(storage("not json").api)).toEqual(defaultPrefs());
    expect(readPrefs(storage('{"version":2,"provider":"anthropic"}').api)).toEqual(defaultPrefs());
    const odd = readPrefs(
      storage(
        JSON.stringify({
          version: 1,
          enabled: "yes",
          provider: "gemini",
          hostId: 7,
          confirmedHosts: ["h1", 3],
          models: { anthropic: { quick: "ok-model", careful: "has space" }, bogus: { quick: "x" } },
          profiles: { "card.title": "careful", "vault.secret": "careful", "team.goal": "fast" },
          openrouterPrivate: "no",
        }),
      ).api,
    );
    expect(odd).toEqual({
      ...defaultPrefs(),
      confirmedHosts: ["h1"],
      models: { anthropic: { quick: "ok-model" } },
      profiles: { "card.title": "careful" },
    });
  });
});

describe("assistant-prefs: the provider a wand uses", () => {
  const ready = { anthropic: true, openrouter: true };

  test("no choice: the host of the field when it has the feature, else another online host with it, else none", () => {
    const p = defaultPrefs();
    const base = { prefs: p, apiSupported: true, keys: ready };
    expect(resolveProvider({ ...base, hosts: [host("a"), host("b")], fieldHostId: "b" })).toEqual({
      provider: "host",
      hostId: "b",
    });
    expect(
      resolveProvider({ ...base, hosts: [host("a", false), host("b")], fieldHostId: "a" }),
    ).toEqual({ provider: "host", hostId: "b" });
    expect(resolveProvider({ ...base, hosts: [host("a", true, false)] })).toBeNull();
    expect(resolveProvider({ ...base, hosts: [] })).toBeNull();
  });

  test("the chosen host is used when the field's own host cannot", () => {
    const prefs = { ...defaultPrefs(), provider: "host" as const, hostId: "b" };
    const base = { prefs, apiSupported: true, keys: ready };
    expect(
      resolveProvider({ ...base, hosts: [host("a", true, false), host("b")], fieldHostId: "a" }),
    ).toEqual({ provider: "host", hostId: "b" });
    // The chosen provider is the host, and the chosen host is gone: another one takes over, no API fallback.
    expect(resolveProvider({ ...base, hosts: [host("b", false), host("c")] })).toEqual({
      provider: "host",
      hostId: "c",
    });
    expect(resolveProvider({ ...base, hosts: [host("b", false)] })).toBeNull();
  });

  test("an API provider is used when it is chosen, supported here and has a key; otherwise there is none (no silent fallback)", () => {
    const hosts = [host("a")];
    const anthropic = { ...defaultPrefs(), provider: "anthropic" as const };
    expect(resolveProvider({ prefs: anthropic, apiSupported: true, keys: ready, hosts })).toEqual({
      provider: "anthropic",
    });
    expect(
      resolveProvider({
        prefs: anthropic,
        apiSupported: true,
        keys: { ...ready, anthropic: false },
        hosts,
      }),
    ).toBeNull();
    // The web build has no shell: an API choice stored by the desktop app is not used there.
    expect(
      resolveProvider({ prefs: anthropic, apiSupported: false, keys: ready, hosts }),
    ).toBeNull();
    const openrouter = { ...defaultPrefs(), provider: "openrouter" as const };
    expect(resolveProvider({ prefs: openrouter, apiSupported: true, keys: ready, hosts })).toEqual({
      provider: "openrouter",
    });
  });
});

describe("assistant-prefs: profiles and models", () => {
  test("a kind has its own profile unless the person changed it", () => {
    const prefs = { ...defaultPrefs(), profiles: { prompt: "careful" as const } };
    expect(profileFor(prefs, "prompt")).toBe("careful");
    for (const kind of Object.keys(KIND_SPECS) as Array<keyof typeof KIND_SPECS>) {
      if (kind !== "prompt") expect(profileFor(prefs, kind)).toBe(KIND_SPECS[kind].profile);
    }
  });

  test("a model is the chosen one, else the provider's default for the profile", () => {
    const prefs = {
      ...defaultPrefs(),
      models: { openrouter: { quick: "meta/llama-4" }, anthropic: { careful: "claude-opus-5-5" } },
    };
    expect(modelFor(prefs, "openrouter", "quick")).toBe("meta/llama-4");
    expect(modelFor(prefs, "openrouter", "careful")).toBe(DEFAULT_MODELS.openrouter.careful);
    expect(modelFor(prefs, "anthropic", "careful")).toBe("claude-opus-5-5");
    expect(modelFor(prefs, "anthropic", "quick")).toBe(DEFAULT_MODELS.anthropic.quick);
    expect(modelFor(prefs, "host", "quick")).toBe(DEFAULT_MODELS.host.quick);
  });
});

describe("assistant-prefs: the host provider asks once per host", () => {
  test("a host is confirmed once, and the confirmation is kept", () => {
    const prefs = defaultPrefs();
    expect(needsHostConfirm(prefs, "h1")).toBe(true);
    const after = confirmHost(prefs, "h1");
    expect(needsHostConfirm(after, "h1")).toBe(false);
    expect(needsHostConfirm(after, "h2")).toBe(true);
    expect(confirmHost(after, "h1").confirmedHosts).toEqual(["h1"]);
  });
});
