import { parsePairingLink } from "@flightdeck/protocol";
import type { T } from "../../i18n/index.ts";
import { type HostNameError, hostNameError } from "../../lib/host-name.ts";
import type { HostConfig } from "../../lib/hosts.ts";
import { pairingErrorText } from "../../lib/pairing-text.ts";
import { probeHost } from "../../lib/probe-host.ts";

/** What the roster reads and does through the app's store. */
export interface RosterCore {
  /** Host tokens, in the OS store only: never in `storage`, a log or an error. */
  secrets: {
    get(id: string): Promise<string | null>;
    set(id: string, value: string): Promise<void>;
    delete(id: string): Promise<void>;
  };
  /** The hosts listed now. */
  hosts(): HostConfig[];
  /** Lists a host, offline until its connection answers. */
  list(config: HostConfig): void;
  /** Keeps the list (ids, names, URLs) in storage. */
  persist(): void;
  /** Opens the connection of a host with its token. */
  connect(config: HostConfig, token: string): void;
  /** Closes the connection of a host. */
  stop(hostId: string): void;
  /** Closes a host's tabs and its connection for good. */
  detach(hostId: string): void;
  /** Forgets everything the app holds about a host once its secret is gone. */
  forget(hostId: string): void;
  /** Changes the name a host shows in the app. */
  setName(hostId: string, name: string): void;
  /** A token typed: the diagnostics hide it from what they show. */
  rememberToken(token: string): void;
  t(): T;
}

/** What a host is added with. */
export interface NewHost {
  name: string;
  url: string;
  token: string;
}

/**
 * Which hosts the app has (#1596: a slice of the store): adding one after testing it, removing it,
 * its name, a new token or pairing link when it refused the old one, and the reconnect. The token
 * goes from here to the OS store and to the connection, nowhere else.
 */
export class HostRosterSlice {
  constructor(private readonly core: RosterCore) {}

  /** Lists a host, keeps its token and connects. */
  async add(input: NewHost): Promise<string> {
    const config: HostConfig = { id: crypto.randomUUID(), name: input.name, url: input.url };
    await this.core.secrets.set(config.id, input.token);
    this.core.list(config);
    this.core.persist();
    this.core.connect(config, input.token);
    return config.id;
  }

  /** Tests the connection (`hello` + `host.info`) and saves the host only if it answers. */
  async testAndAdd(
    input: NewHost,
  ): Promise<{ ok: true; hostId: string } | { ok: false; error: string }> {
    this.core.rememberToken(input.token);
    const probe = await probeHost(input.url, input.token, this.core.t());
    if (!probe.ok) return probe;
    return { ok: true, hostId: await this.add(input) };
  }

  async remove(hostId: string): Promise<void> {
    this.core.detach(hostId);
    await this.core.secrets.delete(hostId);
    this.core.forget(hostId);
    this.core.persist();
  }

  /** Saves the app-side display name (trimmed); the error says why a name is refused. */
  rename(hostId: string, name: string): HostNameError | null {
    const error = hostNameError(name, this.core.hosts(), hostId);
    if (error) return error;
    this.core.setName(hostId, name.trim());
    this.core.persist();
    return null;
  }

  /** A new token or pairing link for a host that refused the old one; the error text, or null. */
  async pairAgain(hostId: string, input: string): Promise<string | null> {
    const host = this.core.hosts().find((h) => h.id === hostId);
    if (!host) return this.core.t()("hostOffline.pairGone");
    const text = input.trim();
    let token = text;
    if (text.toLowerCase().startsWith("flightdeck://")) {
      const parsed = parsePairingLink(text);
      if (!parsed.ok) return pairingErrorText(this.core.t(), parsed.error);
      token = parsed.value.token;
    }
    if (!token) return this.core.t()("hostForm.pairToken");
    const probe = await probeHost(host.url, token, this.core.t());
    if (!probe.ok) return probe.error;
    // The host may have been removed while it was tested: keep no secret for it.
    if (!this.core.hosts().some((h) => h.id === hostId)) {
      return this.core.t()("hostOffline.pairGone");
    }
    await this.core.secrets.set(hostId, token);
    await this.reconnect(hostId);
    return null;
  }

  /** Drops the connection and opens a new one right away. */
  async reconnect(hostId: string): Promise<void> {
    const host = this.core.hosts().find((h) => h.id === hostId);
    const token = await this.core.secrets.get(hostId);
    this.core.stop(hostId);
    if (host && token) this.core.connect(host, token);
  }
}
