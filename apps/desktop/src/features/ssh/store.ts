import type {
  AskpassRequest,
  CommandPayload,
  CommandResults,
  SshTarget,
} from "@flightdeck/protocol";
import { savePayload } from "./ssh.ts";

/** The ssh's part of the app's state (#1596): the prompts waiting for an answer, and the destinos. */
export interface SshSliceState {
  /** The ssh password or passphrase prompts waiting for an answer, oldest first (phase 15). */
  askpass: Array<{ hostId: string; request: AskpassRequest }>;
  /** The ssh destinos of each host that keeps them, by host id; read when the palette opens (phase 15). */
  ssh: Record<string, SshTarget[]>;
}

/** A fresh initial state for each store: its collections are never shared between stores. */
export const initialSshState = (): SshSliceState => ({ askpass: [], ssh: {} });

/** What a secret of the vault answers for a use the app starts: the value, or why it is refused. */
export type SecretAnswer<Refusal> = { ok: true; value: string } | { ok: false; code: Refusal };

/** What the ssh reads and asks through the app's store. */
export interface SshCore<Refusal = string> {
  state(): SshSliceState;
  update(patch: Partial<SshSliceState>): void;
  /** The host's destinos; null when it refuses (the toast says why). */
  list(hostId: string): Promise<CommandResults["ssh.list"] | null>;
  /** The host's destinos, with no toast when it cannot say (the palette is a convenience). */
  peek(hostId: string): Promise<CommandResults["ssh.list"] | null>;
  save(hostId: string, payload: CommandPayload<"ssh.save">): Promise<SshTarget | null>;
  connect(
    hostId: string,
    payload: CommandPayload<"ssh.connect">,
  ): Promise<CommandResults["ssh.connect"] | null>;
  answer(hostId: string, requestId: string, secret: string | null): Promise<unknown>;
  /** Whether the vault keeps this secret. */
  hasSecret(secretId: string): boolean;
  /** The secret's value for ssh on that host, after the vault's delivery rules; logged as "you". */
  secretFor(hostId: string, secretId: string): Promise<SecretAnswer<Refusal>>;
}

/** The ssh destinos of the hosts and the prompts ssh raises (phase 15; #1596: a slice of the store). */
export class SshSlice<Refusal = string> {
  /** Terminals opened from a ssh destino, by `hostId/terminalId`, for the badge of their screen. */
  readonly terminals = new Map<string, { name: string; tags: string[] }>();

  constructor(private readonly core: SshCore<Refusal>) {}

  /** Reads a host's destinos for the palette; they stay as they were when the host cannot say. */
  async loadTargets(hostId: string): Promise<void> {
    const listed = await this.core.peek(hostId);
    if (listed) this.core.update({ ssh: { ...this.core.state().ssh, [hostId]: listed.targets } });
  }

  /**
   * Keeps a copy of `target` (and of the destinos it jumps through) on `runner`, which builds the
   * ssh command from its own destinos: the copy it already has by name is updated, never doubled.
   * `null` when the host refuses.
   */
  async copyTo(
    runner: string,
    target: SshTarget,
    all: SshTarget[],
    seen: Set<string> = new Set([target.id]),
  ): Promise<SshTarget | null> {
    const listed = await this.core.list(runner);
    if (!listed) return null;
    let jump: string | null = null;
    const through = all.find((other) => other.id === target.jump);
    if (through && !seen.has(through.id)) {
      seen.add(through.id);
      const copy = await this.copyTo(runner, through, all, seen);
      if (!copy) return null;
      jump = copy.id;
    }
    const existing = listed.targets.find((other) => other.name === target.name);
    return this.core.save(runner, {
      ...(existing ? { id: existing.id } : {}),
      ...savePayload(target, target.name),
      viaHost: null,
      jump,
    });
  }

  /**
   * Answers a ssh prompt (`null` refuses, and ssh fails at once). The secret is sent and not
   * kept: the request leaves the list, and nothing else holds the answer.
   */
  async answer(hostId: string, requestId: string, secret: string | null): Promise<void> {
    this.core.update({
      askpass: this.core
        .state()
        .askpass.filter(
          (item) => !(item.hostId === hostId && item.request.requestId === requestId),
        ),
    });
    await this.core.answer(hostId, requestId, secret);
  }

  /**
   * ssh asks for a password: when its destino points at a secret of the vault that can be
   * delivered to the host, that answers; otherwise the person is asked.
   */
  async onAskpass(hostId: string, request: AskpassRequest): Promise<void> {
    if (request.secretRef && this.core.hasSecret(request.secretRef)) {
      const got = await this.core.secretFor(hostId, request.secretRef);
      if (got.ok) {
        await this.core.answer(hostId, request.requestId, got.value);
        return;
      }
    }
    this.core.update({ askpass: [...this.core.state().askpass, { hostId, request }] });
  }

  /**
   * Opens a terminal running ssh to `target`; the id of the terminal, or `null` when refused.
   * `privateKey` is the vault key of a `vault-key` destino, for this connection only.
   */
  async connect(hostId: string, target: SshTarget, privateKey?: string): Promise<string | null> {
    const info = await this.core.connect(hostId, {
      targetId: target.id,
      cols: 80,
      rows: 24,
      ...(privateKey ? { privateKey } : {}),
    });
    if (!info) return null;
    this.terminals.set(`${hostId}/${info.terminalId}`, { name: target.name, tags: target.tags });
    return info.terminalId;
  }
}
