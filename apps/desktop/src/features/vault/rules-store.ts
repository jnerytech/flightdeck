import type { CommandPayload, CommandResults, RuleIssue, VaultVerdict } from "@flightdeck/protocol";
import { inSequence } from "@flightdeck/protocol";
import type { T } from "../../i18n/index.ts";
import {
  effectiveRules,
  isGeneratedRule,
  SCOPE_RULE_PREFIX,
  scopingClient,
  stripGenerated,
} from "../../lib/client-vault.ts";
import type { Client } from "../../lib/clients.ts";
import type { SecretMeta } from "./vault.ts";
import type { VaultRules } from "./vault-rules.ts";

/** How long the app waits for changes to settle before it sends scoped rules again. */
const VAULT_SCOPE_DELAY_MS = 300;

/** A host as the rules need it: which one it is, its name for a notice, and whether it is connected. */
export interface RulesHost {
  id: string;
  name: string;
  status: string;
}

/** A host's refusal of a command, kept apart from the error banner: the caller decides what to show. */
export interface RulesRefusal {
  ok: false;
  code: string;
  message: string;
  reason?: string;
  params?: Record<string, string | number>;
  items?: readonly RuleIssue[];
}

/** The commands about a secret's rules: what the app hands a host, and what it reads back. */
type RulesCommand = "vault.rules.set" | "vault.rules.get";

/** A connection of a host, as far as the rules go: the answer, or a rejection. */
export interface RulesConnection {
  request<C extends RulesCommand>(type: C, payload: CommandPayload<C>): Promise<CommandResults[C]>;
}

/** What the rules read and ask through the app's store. */
export interface VaultRulesCore {
  /** The rules the app keeps for each secret (the daemon only holds a copy). */
  rules: Pick<VaultRules, "get" | "set" | "all">;
  /** The vault's secrets, metadata only. */
  secrets(): SecretMeta[];
  hosts(): RulesHost[];
  clients(): Client[];
  /** The projects of a client, as the keys the rules name. */
  projectKeysOf(clientId: string): string[];
  /** Tells the screens that read the secrets (the clients' check) to read them again. */
  secretsChanged(): void;
  /** A command to a host; a refusal comes back as a value instead of the banner. */
  request<C extends RulesCommand>(
    hostId: string,
    type: C,
    payload: CommandPayload<C>,
  ): Promise<{ ok: true; data: CommandResults[C] } | RulesRefusal>;
  /** What the saved rules decide for a use, asked of a host; null when it refuses. */
  preview(
    hostId: string,
    payload: CommandPayload<"vault.rules.preview">,
  ): Promise<VaultVerdict | null>;
  /** A failure for the person to read: the error, and the text to show instead of its message. */
  fail(error: unknown, text?: string): void;
  success(text: string): void;
  t(): T;
}

/**
 * The usage rules of each secret (phase 19; #1596: a slice of the store): kept by the app, checked
 * by the connected hosts, and sent again when a client's scope changes what a secret may do.
 */
export class VaultRulesSlice {
  /** What was last sent of each secret to each host (`hostId/secretId`), as text. */
  private readonly sent = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The send going on, or the last one: the next look waits for it, so two never overlap. */
  private run: Promise<void> = Promise.resolve();
  /** Sends not finished yet: what they carry is not in `sent` until the host answers. */
  private busy = 0;

  constructor(private readonly core: VaultRulesCore) {}

  /** Phase 19: a secret's usage rules, in order. */
  get(secretId: string): unknown[] {
    return this.core.rules.get(secretId);
  }

  /**
   * Phase 19: replaces a secret's rules. The connected hosts check them (the ceiling) and keep a
   * copy; a refusal comes back with the daemon's reason and nothing is saved.
   */
  async set(secretId: string, rules: unknown[]): Promise<{ ok: true } | RulesRefusal> {
    const secret = this.core.secrets().find((s) => s.id === secretId);
    const accepted: string[] = [];
    let refusal: RulesRefusal | null = null;
    for (const host of this.core.hosts()) {
      if (host.status !== "online" || !secret?.allowedHosts.includes(host.id)) continue;
      const result =
        await /* NOSONAR: stops at the first host that refuses, to put back the ones that accepted */ this.core.request(
          host.id,
          "vault.rules.set",
          {
            secretId,
            tags: secret.tags,
            rules: this.effective(secret, rules),
          },
        );
      if (!result.ok) {
        refusal = result;
        break;
      }
      accepted.push(host.id);
    }
    if (refusal && secret) {
      // The hosts that took the refused set go back to the saved one: none keeps rules the
      // app did not save (they could be looser).
      const saved = this.core.rules.get(secretId);
      await inSequence(accepted, async (hostId) => {
        await this.core.request(hostId, "vault.rules.set", {
          secretId,
          tags: secret.tags,
          rules: this.effective(secret, saved),
        });
      });
      return refusal;
    }
    this.core.rules.set(secretId, rules);
    for (const hostId of accepted) {
      this.sent.set(
        `${hostId}/${secretId}`,
        JSON.stringify(this.effective(secret as SecretMeta, rules)),
      );
    }
    // The screens that judge the rules (the clients' check) read them again.
    this.core.secretsChanged();
    return { ok: true };
  }

  /** A secret's rules as a host holds them, without the ones a client generated; null when it does not answer. */
  async readHost(hostId: string, secretId: string): Promise<unknown[] | null> {
    const result = await this.core.request(hostId, "vault.rules.get", { secretId });
    return result.ok ? stripGenerated(result.data.rules) : null;
  }

  /**
   * Phase 19: what the saved rules decide for a use ("what happens if…"), asked of a connected
   * host the secret may go to; null when there is none.
   */
  async preview(
    secretId: string,
    use: Omit<CommandPayload<"vault.rules.preview">, "secretId" | "tags">,
  ): Promise<VaultVerdict | null> {
    const secret = this.core.secrets().find((s) => s.id === secretId);
    const host = this.core
      .hosts()
      .find((h) => h.status === "online" && secret?.allowedHosts.includes(h.id));
    if (!secret || !host) return null;
    return this.core.preview(host.id, { secretId, ...use, tags: secret.tags });
  }

  /** On connect: the host gets the rules of the secrets it may receive, and of no other. */
  onConnect(hostId: string, conn: RulesConnection): void {
    const all = this.core.rules.all();
    for (const secret of this.core.secrets()) {
      const own = all[secret.id];
      if (!own || !secret.allowedHosts.includes(hostId)) continue;
      const rules = this.effective(secret, own);
      this.sent.set(`${hostId}/${secret.id}`, JSON.stringify(rules));
      void this.sendScoped(hostId, conn, secret, rules).catch((error: unknown) =>
        this.core.fail(error),
      );
    }
  }

  /** Looks again, soon, at what scoped secrets are sent: one look for a burst of changes. */
  scopeChanged(): void {
    const scoped = this.core.clients().some((c) => c.defaults.vaultScope);
    // Nothing was sent and none is going: scope off needs nothing. A send still unanswered is
    // not nothing: turning the scope off meanwhile must still send the own rules back.
    if (!scoped && this.sent.size === 0 && this.busy === 0) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.busy++;
      this.run = this.run
        .then(() => this.pushScopes())
        .finally(() => {
          this.busy--;
        });
    }, VAULT_SCOPE_DELAY_MS);
  }

  /** Stops the look that was waiting to run. */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Rules the daemon is sent for a secret: its own, with its client's scope in front (phase 29). */
  private effective(secret: SecretMeta, own: unknown[]): unknown[] {
    return effectiveRules(secret, own, this.core.clients(), (id) => this.core.projectKeysOf(id));
  }

  /**
   * Sends one host the rules of one secret when the scope changed what it holds. Returns the name of
   * the client whose projects changed while it stays scoped (so a widening is said), else null.
   */
  private async pushTo(
    host: RulesHost,
    secret: SecretMeta,
    rules: unknown[],
    text: string,
  ): Promise<string | null> {
    const key = `${host.id}/${secret.id}`;
    const before = this.sent.get(key);
    const scoped = text.includes(SCOPE_RULE_PREFIX);
    // Nothing of this secret was sent by the scope, and none is now: leave it alone.
    if (before === undefined ? !scoped : before === text) return null;
    const result = await this.core.request(host.id, "vault.rules.set", {
      secretId: secret.id,
      tags: secret.tags,
      rules,
    });
    if (!result.ok) {
      // Not held in its client on that host: said, not left to be found out.
      const client = scopingClient(secret, this.core.clients());
      this.core.fail(
        new Error(result.code),
        this.core.t()("clients.scopeRefused", {
          host: host.name,
          name: client?.name ?? "",
          secret: secret.name,
          message: result.message,
        }),
      );
      return null;
    }
    this.sent.set(key, text);
    if (!scoped || !before?.includes(SCOPE_RULE_PREFIX)) return null;
    const client = this.core.clients().find((c) => text.includes(`${SCOPE_RULE_PREFIX}${c.id}:`));
    return client?.name ?? null;
  }

  /**
   * Sends the hosts what changed in the rules of scoped secrets: a client's projects came or went,
   * or scope was turned on or off (the own rules go back). A change in the projects of a client
   * that stays scoped says so, so a widening is never silent.
   */
  private async pushScopes(): Promise<void> {
    const changed = new Set<string>();
    await inSequence(this.core.secrets(), async (secret) => {
      const own = this.core.rules.get(secret.id);
      const rules = this.effective(secret, own);
      const text = JSON.stringify(rules);
      await inSequence(this.core.hosts(), async (host) => {
        if (host.status !== "online" || !secret.allowedHosts.includes(host.id)) return;
        const widened = await this.pushTo(host, secret, rules, text);
        if (widened) changed.add(widened);
      });
    });
    for (const name of changed) this.core.success(this.core.t()("clients.scopeChanged", { name }));
  }

  /**
   * Sends a secret's rules to a host on connect. For a scoped secret the host is asked first what
   * it holds: this app is the only writer of the generated rules, so a host that holds rules but
   * none of them marked had them replaced by someone else (said, then sent again), and marked
   * ones that differ are the client's projects having changed while the host was away.
   */
  private async sendScoped(
    hostId: string,
    conn: RulesConnection,
    secret: SecretMeta,
    rules: unknown[],
  ): Promise<void> {
    const generated = rules.filter(isGeneratedRule);
    const client = generated.length > 0 ? scopingClient(secret, this.core.clients()) : null;
    if (client) {
      const held = await conn
        .request("vault.rules.get", { secretId: secret.id })
        .then((answer) => answer.rules)
        .catch(() => []);
      const marked = held.filter(isGeneratedRule);
      if (held.length > 0 && marked.length === 0) {
        const host = this.core.hosts().find((h) => h.id === hostId)?.name ?? hostId;
        this.core.fail(
          new Error("scope"),
          this.core.t()("clients.scopeVanished", { name: client.name, secret: secret.name, host }),
        );
      } else if (marked.length > 0 && JSON.stringify(marked) !== JSON.stringify(generated)) {
        this.core.success(this.core.t()("clients.scopeChanged", { name: client.name }));
      }
    }
    await conn.request("vault.rules.set", { secretId: secret.id, tags: secret.tags, rules });
  }
}
