import type {
  CommandPayload,
  CommandResults,
  CommandType,
  HostInfoResult,
  TerminalData,
  TerminalExited,
  TerminalInfo,
  TerminalResync,
} from "@flightdeck/protocol";
import {
  type TerminalEnv,
  type TerminalLaunch,
  type TerminalTarget,
  terminalLaunch,
} from "../../lib/terminal.ts";
import type { TerminalHost } from "../../lib/terminal-session.ts";
import { hasFeature } from "../../lib/version.ts";

/** What a host's terminals say to the one following them. */
export interface TerminalListener {
  data(base64: string): void;
  exited(exitCode: number): void;
  resync(): void;
  offline(): void;
}

/** The terminal commands of one host. */
export interface TerminalCommands extends TerminalHost {
  open(cwd: string, cols: number, rows: number): Promise<{ terminalId: string }>;
  list(): Promise<TerminalInfo[]>;
}

/** A terminal frame a host sent: output, the end of the process, or a gap to read again. */
export type TerminalFrame = TerminalData | TerminalExited | TerminalResync;

/** What the terminals need to know of a host. */
export interface TerminalsHost {
  id: string;
  url: string;
  status: string;
  info: { allowedRoots: string[] } | null;
  hostInfo: HostInfoResult | null;
}

/** The tab of a terminal whose close waits for the person's answer. */
export interface ClosingTerminal {
  areaId: string;
  tabId: string;
}

/** What the terminals read and ask through the app's store. */
export interface TerminalsCore {
  hosts(): TerminalsHost[];
  terminalEnv(): TerminalEnv | null;
  /** A terminal command of a host; a refusal throws, the caller decides what the person sees. */
  dispatch<T extends Extract<CommandType, `terminal.${string}`>>(
    hostId: string,
    type: T,
    payload: CommandPayload<T>,
  ): Promise<CommandResults[T]>;
  /** Opens a terminal on a host; a refusal goes to the banner and gives null. */
  open(
    hostId: string,
    payload: CommandPayload<"terminal.open">,
  ): Promise<CommandResults["terminal.open"] | null>;
  /** Ends or detaches a terminal; a refusal goes to the banner. */
  close(hostId: string, terminalId: string, kill: boolean): Promise<unknown>;
  /** Shows the terminal as a tab. */
  showTab(hostId: string, terminalId: string): void;
  /** The tab whose close waits for an answer, and the way to set or clear it. */
  closing(): ClosingTerminal | null;
  setClosing(closing: ClosingTerminal | null): void;
  /** The terminal in the waiting tab, with the way to close that tab; null when it is gone. */
  closingTab(
    closing: ClosingTerminal,
  ): { hostId: string; terminalId: string; closeTab(): void } | null;
  copyText(text: string): Promise<boolean>;
  /** Opens a terminal program on this machine. */
  spawn(program: string, args: string[]): Promise<void>;
  /** A terminal program that did not start: the banner says why. */
  spawnFailed(error: unknown): void;
}

/**
 * The terminals of every host (#1596: a slice of the store): the commands of a host's terminals,
 * the tab a terminal opens in, "Claude aqui", the launch of the person's own terminal, the
 * listeners that follow a terminal's output, and the close that asks detach or end.
 */
export class TerminalsSlice {
  private readonly listeners = new Map<string, Set<TerminalListener>>();

  constructor(private readonly core: TerminalsCore) {}

  /** The commands of a host's terminals, as `TerminalSession` drives them (phase 14). */
  host(hostId: string): TerminalCommands {
    const request = <T extends Extract<CommandType, `terminal.${string}`>>(
      type: T,
      payload: CommandPayload<T>,
    ): Promise<CommandResults[T]> => this.core.dispatch(hostId, type, payload);
    return {
      open: async (cwd, cols, rows) => request("terminal.open", { cwd, cols, rows }),
      attach: (terminalId) => request("terminal.attach", { terminalId, flow: true }),
      ack: (terminalId, bytes) => request("terminal.ack", { terminalId, bytes }),
      write: (terminalId, data) => request("terminal.write", { terminalId, data }),
      resize: (terminalId, cols, rows) => request("terminal.resize", { terminalId, cols, rows }),
      close: (terminalId, kill) => request("terminal.close", { terminalId, kill }),
      list: async () => (await request("terminal.list", {})).terminals,
    };
  }

  /** Opens a terminal on the host (in `cwd`, its first allowed folder by default) in a new tab. */
  async open(hostId: string, cwd?: string): Promise<string | null> {
    const folder = cwd ?? this.core.hosts().find((h) => h.id === hostId)?.info?.allowedRoots[0];
    if (!folder) return null;
    const opened = await this.core.open(hostId, { cwd: folder, cols: 80, rows: 24 });
    if (!opened) return null;
    this.core.showTab(hostId, opened.terminalId);
    return opened.terminalId;
  }

  /** "Claude aqui": `flightdeckd claude` (resuming `claudeSessionId` when given) in a terminal tab. */
  async openClaude(
    hostId: string,
    target: TerminalTarget,
    persona?: string,
  ): Promise<string | null> {
    const opened = await this.core.open(hostId, {
      cwd: target.cwd,
      cols: 80,
      rows: 24,
      claude: {
        ...(target.claudeSessionId ? { resume: target.claudeSessionId } : {}),
        ...(persona ? { persona } : {}),
      },
    });
    if (!opened) return null;
    this.core.showTab(hostId, opened.terminalId);
    return opened.terminalId;
  }

  /** Whether the host opens terminals inside the app (phase 14) right now. */
  embedded(hostId: string): boolean {
    const host = this.core.hosts().find((h) => h.id === hostId);
    return host?.status === "online" && hasFeature(host.hostInfo?.features, "terminal", false);
  }

  /** Calls `listener` with the output, exit, resync and loss of the host of a terminal. */
  follow(hostId: string, terminalId: string, listener: TerminalListener): () => void {
    const key = `${hostId}|${terminalId}`;
    const listeners = this.listeners.get(key) ?? new Set();
    this.listeners.set(key, listeners);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(key);
    };
  }

  /** A terminal frame arrived from a host: the ones following that terminal hear it. */
  deliver(hostId: string, frame: TerminalFrame): void {
    for (const listener of this.listeners.get(`${hostId}|${frame.terminalId}`) ?? []) {
      if (frame.type === "terminal.data") listener.data(frame.data);
      else if (frame.type === "terminal.exited") listener.exited(frame.exitCode);
      else listener.resync();
    }
  }

  /** The terminals of the host are told it is gone. */
  tellOffline(hostId: string): void {
    for (const [key, listeners] of this.listeners) {
      if (key.startsWith(`${hostId}|`)) for (const listener of listeners) listener.offline();
    }
  }

  /** How "Abrir no terminal" opens `target` on this host; `null` for an unknown host. */
  launch(hostId: string, target: TerminalTarget): TerminalLaunch | null {
    const host = this.core.hosts().find((h) => h.id === hostId);
    return host ? terminalLaunch(host, target, this.core.terminalEnv()) : null;
  }

  /** Opens a terminal on this machine, or copies the command for a host elsewhere. */
  async openIn(hostId: string, target: TerminalTarget): Promise<void> {
    const launch = this.launch(hostId, target);
    if (launch?.kind === "copy") await this.core.copyText(launch.text);
    if (launch?.kind !== "spawn") return;
    try {
      await this.core.spawn(launch.program, launch.args);
    } catch (error) {
      this.core.spawnFailed(error);
    }
  }

  /** Ends the pending close of a terminal tab: `kill` ends the process, false detaches, null keeps it. */
  async finishClose(kill: boolean | null): Promise<void> {
    const pending = this.core.closing();
    this.core.setClosing(null);
    if (!pending || kill === null) return;
    const tab = this.core.closingTab(pending);
    if (!tab) return;
    await this.core.close(tab.hostId, tab.terminalId, kill);
    tab.closeTab();
  }
}
