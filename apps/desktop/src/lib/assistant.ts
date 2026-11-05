import {
  ASSISTANT_MAX_INPUT,
  type AssistantKind,
  type AssistantProvider,
  AssistantRefusal,
  type AssistantResult,
  type AssistantRunPayload,
  buildRequest,
  checkOutput,
  KIND_SPECS,
  type ModelOption,
  SecretScanner,
} from "@flightdeck/protocol";
import type { AssistantKeyProvider, AssistantPlatform } from "@/platform/types";
import { RunGate } from "../components/assistant/wand-state.ts";
import {
  type AssistantPrefs,
  confirmHost,
  type HostChoice,
  modelFor,
  needsHostConfirm,
  profileFor,
  type ResolvedProvider,
  readPrefs,
  resolveProvider,
  writePrefs,
} from "./assistant-prefs.ts";

/** What a failed call carries to the screen: a reason it translates, and the values the text fills in. */
export interface AssistantFailure {
  reason: string;
  params?: Record<string, string | number>;
}

export type HostAnswer =
  | { ok: true; data: unknown }
  | {
      ok: false;
      code: string;
      message: string;
      reason?: string;
      params?: Record<string, string | number>;
    };

export interface AssistantControllerDeps {
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  api: AssistantPlatform;
  hosts: () => HostChoice[];
  /** The vault's entries (ids reach the shell, names reach a refusal). */
  secrets: () => Array<{ id: string; name: string }>;
  language: () => string;
  request: (hostId: string, type: string, payload: unknown) => Promise<HostAnswer>;
}

export interface AssistantRunInput {
  requestId: string;
  kind: AssistantKind;
  text: string;
  context?: Record<string, string>;
  /** The host the field belongs to: the host provider prefers it. */
  fieldHostId?: string;
  cwd?: string;
  /** Use this provider for this one call, whatever the preference says (the person clicked "Try with …"). */
  provider?: ResolvedProvider;
}

const KEY_PROVIDERS = ["anthropic", "openrouter"] as const;

const fail = (reason: string, params?: Record<string, string | number>): AssistantFailure => ({
  reason,
  ...(params ? { params } : {}),
});

/** A rejection of the shell: `{ reason, params? }` as it came, anything else is the provider not answering. */
function failureOf(error: unknown): AssistantFailure {
  if (error instanceof AssistantRefusal) return fail(error.reason, error.params);
  const shape = error as { reason?: unknown; params?: unknown } | null;
  if (shape && typeof shape.reason === "string") {
    return fail(shape.reason, (shape.params ?? undefined) as AssistantFailure["params"]);
  }
  return fail("assistant_offline");
}

/**
 * The AI assistant of the app (issue #155, #158): the person's preferences, the state of the API
 * keys (never the keys), and the one place a wand's request is checked and sent. A secret or a
 * vault value in the text refuses the call before anything leaves; a refusal always carries a
 * reason the screen translates.
 */
export class AssistantController {
  readonly gate = new RunGate();
  private current: AssistantPrefs;
  private saved = { anthropic: false, openrouter: false };
  private setup = false;
  private readonly listeners = new Set<() => void>();
  private readonly scanner = new SecretScanner();

  constructor(private readonly deps: AssistantControllerDeps) {
    this.current = readPrefs(deps.storage);
  }

  /** The API providers are available (the desktop shell); false in the web build. */
  get supported(): boolean {
    return this.deps.api.supported;
  }

  prefs(): AssistantPrefs {
    return this.current;
  }

  setPrefs(patch: Partial<AssistantPrefs>): void {
    this.current = { ...this.current, ...patch };
    writePrefs(this.deps.storage, this.current);
    this.emit();
  }

  /** An arrow, so a screen can hand it to `useSyncExternalStore` as it is. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** Which API providers have a key saved, as last read. */
  keys(): { anthropic: boolean; openrouter: boolean } {
    return this.saved;
  }

  async refreshKeys(): Promise<void> {
    if (!this.deps.api.supported) return;
    const next = { anthropic: false, openrouter: false };
    for (const provider of KEY_PROVIDERS) {
      next[provider] = (await this.deps.api.keyStatus(provider)).saved;
    }
    this.saved = next;
    this.emit();
  }

  /** The provider a wand uses now, or null: the wand then opens Settings. */
  resolve(fieldHostId?: string): ResolvedProvider | null {
    return resolveProvider({
      prefs: this.current,
      apiSupported: this.deps.api.supported,
      keys: this.saved,
      hosts: this.deps.hosts(),
      ...(fieldHostId ? { fieldHostId } : {}),
    });
  }

  async run(input: AssistantRunInput): Promise<AssistantResult> {
    const spec = KIND_SPECS[input.kind];
    if (input.text.length > ASSISTANT_MAX_INPUT) {
      throw fail("assistant_too_long", { max: ASSISTANT_MAX_INPUT });
    }
    if (input.text.trim() === "" && !spec.generates) throw fail("assistant_empty_input");
    const provider = input.provider ?? this.resolve(input.fieldHostId);
    if (!provider) throw fail("assistant_not_configured");
    const found = this.scanner.scan(input.text);
    if (found.length > 0) throw fail("assistant_secret_found", { labels: found.join(", ") });
    if (!this.gate.acquire(input.requestId)) throw fail("assistant_rate_limited");
    try {
      const answer =
        provider.provider === "host"
          ? await this.runOnHost(provider.hostId, input)
          : await this.runOnShell(provider.provider, input);
      const checked = checkOutput(input.kind, input.text, answer.text);
      return { ...answer, text: checked.text, notices: [...answer.notices, ...checked.notices] };
    } catch (error) {
      throw failureOf(error);
    } finally {
      this.gate.release(input.requestId);
    }
  }

  keyStatus(provider: AssistantKeyProvider): Promise<{ saved: boolean; last4?: string }> {
    return this.deps.api.keyStatus(provider);
  }

  /** The only place a key goes in; the state of the keys is read again after it. */
  async saveKey(provider: AssistantKeyProvider, key: string): Promise<{ last4: string }> {
    const stored = await this.deps.api.setKey(provider, key);
    await this.refreshKeys();
    return stored;
  }

  async removeKey(provider: AssistantKeyProvider): Promise<void> {
    await this.deps.api.deleteKey(provider);
    await this.refreshKeys();
  }

  testKey(provider: AssistantKeyProvider): ReturnType<AssistantPlatform["test"]> {
    return this.deps.api.test(provider);
  }

  models(provider: AssistantKeyProvider): Promise<ModelOption[]> {
    return this.deps.api.models(provider);
  }

  /** The other providers that could run now: a click on one is the only way another provider is used. */
  alternatives(current: ResolvedProvider): ResolvedProvider[] {
    const out: ResolvedProvider[] = [];
    const able = this.deps.hosts().find((host) => host.online && host.assistant);
    if (current.provider !== "host" && able) out.push({ provider: "host", hostId: able.id });
    if (this.deps.api.supported) {
      for (const provider of KEY_PROVIDERS) {
        if (provider !== current.provider && this.saved[provider]) out.push({ provider });
      }
    }
    return out;
  }

  needsHostConfirm(on: ResolvedProvider): boolean {
    return on.provider === "host" && needsHostConfirm(this.current, on.hostId);
  }

  confirmHost(hostId: string): void {
    this.setPrefs({ confirmedHosts: confirmHost(this.current, hostId).confirmedHosts });
  }

  /** True after a wand found no provider: Settings shows its notice and goes to the section. */
  wantsSetup(): boolean {
    return this.setup;
  }

  askForSetup(): void {
    this.setup = true;
    this.emit();
  }

  setupShown(): void {
    this.setup = false;
    this.emit();
  }

  async cancel(requestId: string, on: ResolvedProvider): Promise<void> {
    if (on.provider === "host") {
      await this.deps.request(on.hostId, "assistant.cancel", { requestId });
    } else {
      await this.deps.api.cancel(requestId);
    }
  }

  private async runOnHost(hostId: string, input: AssistantRunInput): Promise<AssistantResult> {
    const profile = profileFor(this.current, input.kind);
    const payload: AssistantRunPayload = {
      requestId: input.requestId,
      kind: input.kind,
      text: input.text,
      ...(input.context ? { context: input.context } : {}),
      language: this.deps.language(),
      profile,
      model: modelFor(this.current, "host", profile),
      ...(input.cwd ? { cwd: input.cwd } : {}),
    };
    const answer = await this.deps.request(hostId, "assistant.run", payload);
    if (!answer.ok) {
      throw fail(
        answer.reason ?? "assistant_host_unavailable",
        answer.reason ? answer.params : { detail: answer.message },
      );
    }
    return answer.data as AssistantResult;
  }

  private async runOnShell(
    provider: Exclude<AssistantProvider, "host">,
    input: AssistantRunInput,
  ): Promise<AssistantResult> {
    const profile = profileFor(this.current, input.kind);
    const request = buildRequest({
      requestId: input.requestId,
      kind: input.kind,
      text: input.text,
      ...(input.context ? { context: input.context } : {}),
      language: this.deps.language(),
      model: modelFor(this.current, provider, profile),
    });
    const secrets = this.deps.secrets();
    const ids = secrets.map((secret) => secret.id);
    const hits = await this.deps.api.vaultHits(input.text, ids);
    if (hits.length > 0) {
      const names = secrets.filter((secret) => hits.includes(secret.id)).map((s) => s.name);
      throw fail("assistant_vault_value", { names: names.join(", ") });
    }
    return this.deps.api.run(request, ids);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
