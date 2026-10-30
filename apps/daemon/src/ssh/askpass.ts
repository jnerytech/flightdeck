import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AskpassRequest, SshTarget } from "@flightdeck/protocol";
import { readConfig } from "../costs/statusline.ts";
import { FlightdeckError } from "../errors.ts";
import { DaemonClient, daemonUrl } from "../mcp.ts";
import type { Timers } from "../quota/quota.ts";
import { ulid } from "../ulid.ts";
import type { AskpassHook } from "./connect.ts";

export interface AskpassBrokerOptions {
  timers?: Timers;
  now?: () => number;
  /** How long a ticket lives (10 minutes when absent). */
  ttlMs?: number;
  /** How long the app has to answer (120 seconds when absent). */
  answerMs?: number;
}

const TICKET_TTL_MS = 10 * 60_000;
const ANSWER_MS = 120_000;
/** A wrong password is asked again by ssh; a few asks per ticket, not an open door. */
const MAX_USES = 5;

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface Ticket {
  targetId: string;
  targetName: string;
  secretRef: string | null;
  kind: "password" | "passphrase";
  expiresAt: number;
  uses: number;
}

interface Pending {
  resolve(secret: string): void;
  reject(error: Error): void;
  timer: unknown;
}

/**
 * Passwords and key passphrases for ssh (phase 15). ssh runs the `flightdeckd askpass` helper,
 * which asks the daemon with the ticket the connection was started with; the daemon asks the
 * apps that are watching, and the first answer goes back. The answer passes through here and
 * is kept nowhere: not in a field, not in a log.
 */
export class AskpassBroker {
  private readonly tickets = new Map<string, Ticket>();
  private readonly watchers = new Set<(frame: AskpassRequest) => void>();
  private readonly pending = new Map<string, Pending>();
  private readonly timers: Timers;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly answerMs: number;

  constructor(opts: AskpassBrokerOptions) {
    this.timers = opts.timers ?? realTimers;
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? TICKET_TTL_MS;
    this.answerMs = opts.answerMs ?? ANSWER_MS;
  }

  /** A ticket for one connection to `target`, to be put in the environment of its ssh. */
  issue(target: SshTarget, kind: "password" | "passphrase"): string {
    const ticket = crypto.randomUUID().replaceAll("-", "");
    this.tickets.set(ticket, {
      targetId: target.id,
      targetName: target.name,
      secretRef: target.secretRef,
      kind,
      expiresAt: this.now() + this.ttlMs,
      uses: 0,
    });
    this.timers.set(() => this.tickets.delete(ticket), this.ttlMs);
    return ticket;
  }

  /** The apps that follow requests; returns how to stop. */
  watch(fn: (frame: AskpassRequest) => void): () => void {
    this.watchers.add(fn);
    return () => {
      this.watchers.delete(fn);
    };
  }

  /** What the helper calls: resolves with what the app answered, or fails at once. */
  async ask(ticketId: string, prompt: string): Promise<string> {
    const ticket = this.tickets.get(ticketId);
    if (!ticket || ticket.expiresAt <= this.now() || ticket.uses >= MAX_USES) {
      throw new FlightdeckError("unauthorized", "ticket do askpass inválido");
    }
    if (this.watchers.size === 0) {
      throw new FlightdeckError("invalid_state", "nenhum app conectado para responder à senha");
    }
    ticket.uses++;
    const requestId = ulid(this.now());
    return new Promise<string>((resolve, reject) => {
      const timer = this.timers.set(() => {
        this.pending.delete(requestId);
        reject(new FlightdeckError("invalid_state", "ninguém respondeu ao pedido a tempo"));
      }, this.answerMs);
      this.pending.set(requestId, { resolve, reject, timer });
      const frame: AskpassRequest = {
        type: "askpass.request",
        requestId,
        targetId: ticket.targetId,
        targetName: ticket.targetName,
        kind: ticket.kind,
        secretRef: ticket.secretRef,
        prompt,
      };
      for (const watcher of [...this.watchers]) watcher(frame);
    });
  }

  /** The app's answer; `null` is a refusal. The first answer wins. */
  answer(requestId: string, secret: string | null): void {
    const pending = this.pending.get(requestId);
    if (!pending) throw new FlightdeckError("not_found", "pedido não encontrado");
    this.pending.delete(requestId);
    this.timers.clear(pending.timer);
    if (secret === null) {
      pending.reject(new FlightdeckError("invalid_state", "pedido cancelado pelo app"));
    } else {
      pending.resolve(secret);
    }
  }
}

/** A word for `sh`: in single quotes, with the quotes inside closed and escaped. */
const quoteForSh = (word: string) => `'${word.replaceAll("'", `'\\''`)}'`;

/**
 * The program `SSH_ASKPASS` points to: ssh runs it with the prompt as its only argument, and it
 * calls `flightdeckd askpass`. It holds no secret, only this daemon's own command line.
 */
export function writeAskpassScript(opts: {
  dir: string;
  platform: NodeJS.Platform;
  self: string[];
}): string {
  const win = opts.platform === "win32";
  let text: string;
  if (win) {
    if (opts.self.some((part) => /["%]/.test(part))) {
      throw new FlightdeckError(
        "internal",
        "o caminho do flightdeckd não cabe num .cmd (% ou aspas)",
      );
    }
    text = `@echo off\r\n${opts.self.map((part) => `"${part}"`).join(" ")} askpass %*\r\n`;
  } else {
    text = `#!/bin/sh\nexec ${opts.self.map(quoteForSh).join(" ")} askpass "$@"\n`;
  }
  mkdirSync(opts.dir, { recursive: true });
  const file = join(opts.dir, win ? "askpass.cmd" : "askpass.sh");
  if (!existsSync(file) || readFileSync(file, "utf8") !== text) writeFileSync(file, text);
  if (!win) chmodSync(file, 0o755);
  return file;
}

/** `flightdeckd askpass`: asks the daemon of this host for the answer to ssh's prompt. */
export async function runAskpass(opts: {
  configFile: string;
  ticket: string | undefined;
  prompt: string;
}): Promise<string> {
  if (!opts.ticket) throw new Error("sem ticket do askpass (FLIGHTDECK_ASKPASS_TICKET)");
  const config = readConfig(opts.configFile);
  if (!config) throw new Error(`sem config do Flightdeck em ${opts.configFile}`);
  const daemon = await DaemonClient.connect(
    daemonUrl(config),
    config.token,
    "flightdeckd-askpass",
  ).catch(() => {
    throw new Error("não consegui falar com o daemon");
  });
  try {
    const answer = await daemon.call("askpass.ask", { ticket: opts.ticket, prompt: opts.prompt });
    return answer.secret;
  } finally {
    daemon.close();
  }
}

/**
 * What the connector needs for passwords and passphrases; `undefined` (no askpass, and ssh falls
 * back to asking in its terminal) when the script cannot be written for this host.
 */
export function askpassHook(opts: {
  broker: AskpassBroker;
  dir: string;
  platform: NodeJS.Platform;
  self: string[];
  configFile: string;
}): AskpassHook | undefined {
  try {
    const script = writeAskpassScript({ dir: opts.dir, platform: opts.platform, self: opts.self });
    return {
      script,
      configFile: opts.configFile,
      ticket: (target, kind) => opts.broker.issue(target, kind),
    };
  } catch {
    return undefined;
  }
}
