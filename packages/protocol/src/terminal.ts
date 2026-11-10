// The embedded terminals: open, attach, write, resize and close a shell on the host (issue #1600: moved from index.ts).
import { z } from "zod";
import { cmd } from "./command.ts";

// Phase 14: terminals embedded in the host (a real shell behind a PTY).
export const TerminalInfo = z.object({
  terminalId: z.string(),
  cwd: z.string(),
  /** The program only, never its arguments. */
  command: z.string(),
  startedAt: z.string(),
  /** Connections following it now. */
  attached: z.number().int().nonnegative(),
  cols: z.number().int(),
  rows: z.number().int(),
  /** `null` while the process runs. */
  exitCode: z.number().int().nullable(),
  /** The launch of a "Claude aqui" terminal, which the session in the central also carries. */
  launchId: z.string().nullable(),
});
export type TerminalInfo = z.infer<typeof TerminalInfo>;

export const TerminalAttachResult = z.object({
  terminalId: z.string(),
  /** base64 of the output the terminal kept (at most 2 MB): where to continue from. */
  scrollback: z.string(),
  cols: z.number().int(),
  rows: z.number().int(),
  exitCode: z.number().int().nullable(),
  /** The host holds output back until it is acknowledged (`terminal.ack`); absent on older hosts. */
  flow: z.boolean().optional(),
});
export type TerminalAttachResult = z.infer<typeof TerminalAttachResult>;

/** Whether the host's terminals are on, how many at most and which shell they open. */
export const TerminalSettings = z.object({
  enabled: z.boolean(),
  max: z.number().int(),
  /** The program of the default shell. */
  shell: z.string(),
});
export type TerminalSettings = z.infer<typeof TerminalSettings>;

const TerminalId = z.string().min(1);

export const TerminalCols = z.number().int().min(1).max(500);

export const TerminalRows = z.number().int().min(1).max(300);

/** Output of an attached terminal: base64, in frames of at most 16 KB every 16 ms. */
export const TerminalData = z.object({
  type: z.literal("terminal.data"),
  terminalId: z.string(),
  data: z.string(),
});
export type TerminalData = z.infer<typeof TerminalData>;

/** The process of a terminal ended (after the last of its output). */
export const TerminalExited = z.object({
  type: z.literal("terminal.exited"),
  terminalId: z.string(),
  exitCode: z.number().int(),
});
export type TerminalExited = z.infer<typeof TerminalExited>;

/**
 * This connection could not follow the terminal's output and lost it: attach again, which
 * returns the scrollback to continue from. Nothing more arrives until it does.
 */
export const TerminalResync = z.object({
  type: z.literal("terminal.resync"),
  terminalId: z.string(),
});
export type TerminalResync = z.infer<typeof TerminalResync>;

/** The terminal commands; index.ts spreads them into `Command`. */
export const terminalCommands = [
  cmd(
    "terminal.open",
    z
      .object({
        cwd: z.string().min(1),
        /** An argv, never run through a shell; the host's default shell when absent. */
        command: z.array(z.string().min(1)).min(1).max(64).optional(),
        /** "Claude aqui": `flightdeckd claude` in the cwd, with `--resume <id>` when given. */
        claude: z
          .object({
            resume: z
              .string()
              .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, "invalid session id")
              .optional(),
            /** Phase 20: `--persona <id>` (a persona of the host, the project or the pack). */
            persona: z
              .string()
              .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "invalid persona id")
              .optional(),
          })
          .optional(),
        cols: TerminalCols,
        rows: TerminalRows,
      })
      .refine((payload) => !(payload.command && payload.claude), {
        message: "command and claude cannot go together",
      }),
  ),
  /**
   * Issue #107: a shell in the folder the host holds for a managed session (its worktree), never in
   * a path the app sends. The host's default shell; `terminal.open` stays for the rest.
   */
  cmd(
    "terminal.openSession",
    z.object({ session: z.string().min(1), cols: TerminalCols, rows: TerminalRows }).strict(),
  ),
  /** Keyboard input, UTF-8. */
  cmd("terminal.write", z.object({ terminalId: TerminalId, data: z.string().max(262_144) })),
  cmd(
    "terminal.resize",
    z.object({ terminalId: TerminalId, cols: TerminalCols, rows: TerminalRows }),
  ),
  /**
   * Returns the scrollback and starts `terminal.data` frames for this connection. With `flow` the
   * host stops sending once too much output is unacknowledged (see `terminal.ack`); the result's
   * `flow` says whether it did.
   */
  cmd("terminal.attach", z.object({ terminalId: TerminalId, flow: z.boolean().optional() })),
  /** Flow control: `bytes` of output the app has drawn since its last ack. */
  cmd("terminal.ack", z.object({ terminalId: TerminalId, bytes: z.number().int().positive() })),
  cmd("terminal.detach", z.object({ terminalId: TerminalId })),
  /** `kill` ends the process; without it the terminal is only detached (and a dead one removed). */
  cmd("terminal.close", z.object({ terminalId: TerminalId, kill: z.boolean() })),
  cmd("terminal.list", z.object({}).strict()),
  /** Turns the host's terminals on (asks for `confirm`) or off (ends the live ones). */
  cmd("terminal.settings", z.object({ enabled: z.boolean(), confirm: z.boolean().optional() })),
] as const;

/** The `data` of each terminal command's ack; `CommandResults` extends it. */
export interface TerminalResults {
  "terminal.open": TerminalInfo;
  "terminal.openSession": TerminalInfo;
  "terminal.write": undefined;
  "terminal.resize": undefined;
  "terminal.attach": TerminalAttachResult;
  "terminal.ack": undefined;
  "terminal.detach": undefined;
  "terminal.close": undefined;
  "terminal.list": { terminals: TerminalInfo[] };
  "terminal.settings": TerminalSettings;
}
