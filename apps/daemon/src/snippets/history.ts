import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Snippet, SnippetHistoryCandidate } from "@flightdeck/protocol";
import { hasControl, type SecretScanner } from "./model.ts";
import type { Snippets } from "./store.ts";

export interface HistorySources {
  bash?: string;
  zsh?: string;
  psreadline?: string;
}

export interface HistoryImporterOptions {
  sources: HistorySources;
  scanner: SecretScanner;
  snippets: Snippets;
}

/** Where each shell keeps its history by default. */
export function defaultHistorySources(opts: {
  home: string;
  appData: string | undefined;
  platform: NodeJS.Platform;
}): Required<HistorySources> {
  const psreadline =
    opts.platform === "win32"
      ? join(
          opts.appData ?? join(opts.home, "AppData", "Roaming"),
          "Microsoft",
          "Windows",
          "PowerShell",
          "PSReadLine",
          "ConsoleHost_history.txt",
        )
      : join(opts.home, ".local", "share", "powershell", "PSReadLine", "ConsoleHost_history.txt");
  return {
    bash: join(opts.home, ".bash_history"),
    zsh: join(opts.home, ".zsh_history"),
    psreadline,
  };
}

type Shell = "bash" | "zsh" | "powershell";

const SOURCES: Array<{ key: keyof HistorySources; shell: Shell }> = [
  { key: "bash", shell: "bash" },
  { key: "zsh", shell: "zsh" },
  { key: "psreadline", shell: "powershell" },
];

/** Only the end of a huge history is read. */
const MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_LIMIT = 50;
const MAX_COMMAND = 4000;
const TRIVIAL = new Set([
  "ls",
  "ll",
  "la",
  "cd",
  "pwd",
  "clear",
  "cls",
  "exit",
  "history",
  "true",
  "false",
]);
const IMPORT_TAG = "histórico";

/** The text of a history file, from its end if it is large; `null` when there is no such file. */
function readHistory(path: string): string | null {
  if (!existsSync(path)) return null;
  const size = statSync(path).size;
  let text: string;
  if (size <= MAX_BYTES) {
    text = readFileSync(path, "utf8");
  } else {
    const buffer = Buffer.alloc(MAX_BYTES);
    const fd = openSync(path, "r");
    try {
      readSync(fd, buffer, 0, MAX_BYTES, size - MAX_BYTES);
    } finally {
      closeSync(fd);
    }
    // The cut fell in the middle of a line: that one is not a command.
    text = buffer.toString("utf8");
    text = text.slice(text.indexOf("\n") + 1);
  }
  return text.replace(/^﻿/, "");
}

/**
 * The commands of a history, one entry each. `continuation` is the character that ends a line
 * that goes on in the next one: such an entry is more than one line and is left out.
 */
function parseHistory(shell: Shell, text: string): string[] {
  const continuation = shell === "zsh" ? "\\" : shell === "powershell" ? "`" : null;
  const commands: string[] = [];
  let skipping = false;
  for (const raw of text.split(/\r?\n/)) {
    let line = raw;
    if (shell === "bash" && /^#\d+$/.test(line)) continue;
    if (shell === "zsh" && !skipping) line = line.replace(/^: \d+:\d+;/, "");
    const goesOn = continuation !== null && line.endsWith(continuation);
    if (skipping || goesOn) {
      skipping = goesOn;
      continue;
    }
    const command = line.trim();
    if (command !== "") commands.push(command);
  }
  return commands;
}

/** Worth offering as a snippet: one line, plain, and not just `ls` or `cd ..`. */
function eligible(command: string): boolean {
  if (command.length > MAX_COMMAND || hasControl(command, "\t")) return false;
  const tokens = command.split(/\s+/);
  if (TRIVIAL.has(tokens[0] as string) && tokens.length <= 2) return false;
  return tokens.length >= 2 || command.length >= 8;
}

const idOf = (command: string) => createHash("sha256").update(command).digest("hex").slice(0, 16);

/** A name for the snippet: the first words of the command, as plain text. */
function slug(command: string): string {
  const words = command
    .split(/\s+/)
    .slice(0, 3)
    .map((word) => word.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter((word) => word !== "");
  return words.join("-").slice(0, 64) || "comando";
}

interface Entry {
  command: string;
  count: number;
  shells: Shell[];
}

/**
 * Import from the shell history (phase 18). The histories are only read, never written. Every
 * line is scanned for secrets before anyone sees it: a flagged line is hidden and can never be
 * imported, not even after it is revealed; the rest goes to the host's own snippets and never to
 * a project's versioned file.
 */
export class HistoryImporter {
  constructor(private readonly opts: HistoryImporterOptions) {}

  preview(options: { limit?: number; reveal?: boolean }): {
    candidates: SnippetHistoryCandidate[];
    sources: Array<{ shell: string; found: boolean }>;
  } {
    const { entries, sources } = this.read();
    const candidates = entries.slice(0, options.limit ?? DEFAULT_LIMIT).map((entry) => {
      const flagged = this.opts.scanner.scan(entry.command);
      const hidden = flagged.length > 0 && options.reveal !== true;
      return {
        id: idOf(entry.command),
        command: hidden ? null : entry.command,
        count: entry.count,
        shells: entry.shells,
        flagged,
        hidden,
        selectable: flagged.length === 0,
      };
    });
    return { candidates, sources };
  }

  /** Makes the chosen lines snippets of the host; says why the others were not. */
  import(ids: string[]): { created: Snippet[]; skipped: Array<{ id: string; reason: string }> } {
    const { entries } = this.read();
    const byId = new Map(entries.map((entry) => [idOf(entry.command), entry]));
    const created: Snippet[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    for (const id of new Set(ids)) {
      const entry = byId.get(id);
      const skip = (reason: string) => skipped.push({ id, reason });
      if (!entry) {
        skip("não está no histórico");
      } else if (this.opts.scanner.scan(entry.command).length > 0) {
        skip("marcada como segredo");
      } else if (this.taken().some((s) => s.run === entry.command)) {
        skip("já existe um snippet com este comando");
      } else {
        // Plain, one line, scanned and with a free name: the checks of a snippet cannot fail now.
        created.push(
          this.opts.snippets.save({
            scope: "host",
            name: this.freeName(slug(entry.command)),
            type: "command",
            run: entry.command,
            tags: [IMPORT_TAG],
          }),
        );
      }
    }
    return { created, skipped };
  }

  private taken(): Snippet[] {
    return this.opts.snippets.list({ scope: "host" }).snippets;
  }

  private freeName(base: string): string {
    const names = new Set(this.taken().map((s) => s.name));
    let name = base;
    for (let n = 2; names.has(name); n++) name = `${base.slice(0, 60)}-${n}`;
    return name;
  }

  /** Every eligible command of every history, most used first. */
  private read(): { entries: Entry[]; sources: Array<{ shell: string; found: boolean }> } {
    const counts = new Map<string, Entry>();
    const sources: Array<{ shell: string; found: boolean }> = [];
    for (const { key, shell } of SOURCES) {
      const path = this.opts.sources[key];
      if (path === undefined) continue;
      const text = readHistory(path);
      sources.push({ shell, found: text !== null });
      for (const command of parseHistory(shell, text ?? "").filter(eligible)) {
        const entry = counts.get(command) ?? { command, count: 0, shells: [] };
        entry.count++;
        if (!entry.shells.includes(shell)) entry.shells.push(shell);
        counts.set(command, entry);
      }
    }
    const entries = [...counts.values()].sort(
      (a, b) => b.count - a.count || (a.command < b.command ? -1 : 1),
    );
    return { entries, sources };
  }
}
