import type { SnippetField, TerminalInfo } from "@flightdeck/protocol";
import { type Central, messageExternal } from "../central/central.ts";
import { FlightdeckError } from "../errors.ts";
import type { Exec } from "../exec.ts";
import { resolveAllowedCwd } from "../paths.ts";
import type { SessionManager } from "../sessions/session-manager.ts";
import type { TerminalManager } from "../terminal/terminal-manager.ts";
import { fieldsOf, renderSnippet, type SnippetContext, type SnippetDef } from "./model.ts";
import type { Snippets } from "./store.ts";

export interface SnippetUseOptions {
  snippets: Snippets;
  /** The terminals to paste into and open (phase 14). */
  terminals?: Pick<TerminalManager, "write" | "open">;
  /** The managed sessions a prompt can be sent to. */
  manager: Pick<SessionManager, "send">;
  /** Terminal sessions with a channel (phase 5). */
  central?: Pick<Central, "external" | "receptor">;
  /** Runs `git` to read the branch of a cwd. */
  exec: Exec;
  /** The folders a cwd must be in. */
  allowedRoots: readonly string[];
}

export interface UseRequest {
  id: string;
  action: "paste" | "run" | "send";
  values?: Record<string, string>;
  context?: { cwd?: string; file?: string; selection?: string };
  /** `paste`: the terminal to write into. */
  terminalId?: string;
  /** `paste`: also press Enter, which runs the command. */
  enter?: boolean;
  /** `run`: the size of the new tab. */
  cols?: number;
  rows?: number;
  /** `send`: exactly one of a managed session and a terminal session. */
  sessionId?: string;
  claudeSessionId?: string;
}

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;

const badRequest = (message: string) => new FlightdeckError("bad_request", message);

/**
 * Uses a snippet (phase 18): fills its fields and either types the command into a terminal, runs
 * it in a new tab, or sends the prompt to a session. A command that comes from a project's
 * versioned file runs only when the file is trusted; pasting it, without Enter, never needs that.
 * Nothing here runs because Claude asked: Claude only reads snippets (the MCP).
 */
export class SnippetUse {
  constructor(private readonly opts: SnippetUseOptions) {}

  /** The text a use would produce, and the fields it asks for. */
  async render(req: Pick<UseRequest, "id" | "values" | "context">): Promise<{
    text: string;
    fields: SnippetField[];
  }> {
    const { text, fields } = await this.fill(req);
    return { text, fields };
  }

  async use(req: UseRequest): Promise<{ text: string; terminal: TerminalInfo | null }> {
    const snippet = this.opts.snippets.get(req.id);
    const isCommand = snippet.type === "command";
    if (isCommand !== (req.action !== "send")) {
      throw badRequest(
        isCommand
          ? "um comando é colado ou rodado, não enviado"
          : "um prompt é enviado, não colado nem rodado",
      );
    }
    const runs = req.action === "run" || req.enter === true;
    if (runs && !snippet.runnable) {
      throw new FlightdeckError(
        "snippet_untrusted",
        "este comando vem do .flightdeck/snippets.yaml do projeto: confie no arquivo para rodá-lo, ou cole sem Enter",
      );
    }
    const { text } = await this.fill(req);
    let terminal: TerminalInfo | null = null;
    if (req.action === "paste") {
      if (!req.terminalId) throw badRequest("colar pede o terminalId");
      this.terminals().write(req.terminalId, req.enter ? `${text}\r` : text);
    } else if (req.action === "run") {
      const cwd = req.context?.cwd;
      if (!cwd) throw badRequest("rodar pede o cwd");
      terminal = this.terminals().open({
        cwd,
        cols: req.cols ?? DEFAULT_COLS,
        rows: req.rows ?? DEFAULT_ROWS,
      });
      // The shell is still starting: what is written waits in the terminal for it.
      this.terminals().write(terminal.terminalId, `${text}\r`);
    } else {
      this.send(req, text);
    }
    this.opts.snippets.markUsed(req.id);
    return { text, terminal };
  }

  private terminals(): Pick<TerminalManager, "write" | "open"> {
    if (!this.opts.terminals) throw new FlightdeckError("invalid_state", "terminais indisponíveis");
    return this.opts.terminals;
  }

  private send(req: UseRequest, text: string): void {
    if ((req.sessionId === undefined) === (req.claudeSessionId === undefined)) {
      throw badRequest("enviar pede sessionId ou claudeSessionId, um dos dois");
    }
    if (req.sessionId !== undefined) {
      this.opts.manager.send(req.sessionId, text);
      return;
    }
    const claudeSessionId = req.claudeSessionId as string;
    const central = this.opts.central;
    if (!central?.external.get(claudeSessionId)) {
      throw new FlightdeckError("not_found", `sessão ${claudeSessionId} não existe`);
    }
    if (!messageExternal(central, claudeSessionId, text)) {
      throw new FlightdeckError(
        "invalid_state",
        "sessão sem canal: só sessões abertas com flightdeckd claude recebem mensagens",
      );
    }
  }

  private async fill(req: Pick<UseRequest, "id" | "values" | "context">) {
    const snippet = this.opts.snippets.get(req.id);
    const def: SnippetDef = {
      name: snippet.name,
      type: snippet.type,
      run: snippet.run,
      text: snippet.text,
      vars: snippet.vars,
      tags: snippet.tags,
    };
    const context: SnippetContext = { ...req.context };
    const wantsBranch = snippet.fields.some((field) => field.name === "branch");
    if (wantsBranch && context.cwd !== undefined) {
      const branch = await this.branchOf(context.cwd);
      if (branch !== null) context.branch = branch;
    }
    return { text: renderSnippet(def, req.values ?? {}, context), fields: fieldsOf(def) };
  }

  /** The branch checked out in `cwd`; `null` when it is not a repository or HEAD is detached. */
  private async branchOf(cwd: string): Promise<string | null> {
    const dir = resolveAllowedCwd(cwd, this.opts.allowedRoots);
    const { code, stdout } = await this.opts.exec([
      "git",
      "-C",
      dir,
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]);
    const branch = stdout.trim();
    return code === 0 && branch !== "" && branch !== "HEAD" ? branch : null;
  }
}
