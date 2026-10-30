/**
 * Phase 13: the risk of a permission request, low, medium or high, by declared rules and no AI.
 * Every rule that applies is a candidate and the highest wins, so `risk.extraHigh` only adds.
 * Anything the rules do not know is medium, never low.
 */
import { join, resolve } from "node:path";
import { isInside } from "../paths.ts";

export type RiskLevel = "low" | "medium" | "high";

export interface Risk {
  level: RiskLevel;
  reason: string;
  /** The tool reaches the network: never approved automatically. */
  network: boolean;
}

export interface RiskOptions {
  allowedRoots: readonly string[];
  /** The user's home, for `~` and the credential paths. */
  home: string;
  /** Regexes of shell commands that are high on top of the built-in rules (`risk.extraHigh`). */
  extraHigh?: readonly string[];
}

/** Whether a `risk.extraHigh` pattern compiles. */
export function validRegex(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

const RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

type Candidate = [RiskLevel, string];

const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const READ_TOOLS: Record<string, string[]> = {
  Read: ["file_path"],
  Glob: ["path"],
  Grep: ["path"],
  LS: ["path"],
};
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const NETWORK_TOOLS = new Set(["WebFetch", "WebSearch"]);

/** Programs that read or run what a pipe hands them. */
const SHELLS = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "pwsh",
  "powershell",
  "cmd",
  "iex",
  "invoke-expression",
]);
/** Programs that talk to the network (beyond the spec: they never go automatic either). */
const NETWORK_PROGRAMS = new Set([
  "curl",
  "wget",
  "invoke-webrequest",
  "iwr",
  "invoke-restmethod",
  "irm",
  "ssh",
  "scp",
  "sftp",
  "rsync",
  "nc",
  "ncat",
  "telnet",
  "ftp",
]);
/** Redirection targets that go nowhere. */
const SINKS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "nul", "$null"]);
/** What may come before the program and is not it. */
const PREFIXES = new Set(["command", "nohup", "time", "exec", "builtin", "env", "xargs"]);

/**
 * Whether a path (or a glob, or a word of a command) names a credential: ~/.ssh, ~/.aws,
 * ~/.config/gh, ~/.claude/.credentials.json, ~/.claude.json, ~/.flightdeck/config.json, .env*,
 * *.pem, *.key and id_*. Compared without case, with either slash.
 */
function credential(text: string): boolean {
  const parts = text.toLowerCase().replaceAll("\\", "/").split("/");
  const name = parts.at(-1) as string;
  const after = (dir: string, next: string) =>
    parts.some((p, i) => p === dir && parts[i + 1] === next);
  return (
    parts.includes(".ssh") ||
    parts.includes(".aws") ||
    after(".config", "gh") ||
    after(".claude", ".credentials.json") ||
    after(".flightdeck", "config.json") ||
    name === ".claude.json" ||
    name.startsWith(".env") ||
    name.endsWith(".pem") ||
    name.endsWith(".key") ||
    name.startsWith("id_")
  );
}

/** The words of a command, without quotes, split also where a path cannot go on. */
const words = (command: string) => command.split(/[\s"'`;|&<>()=,]+/).filter((w) => w !== "");

/** Separate commands (`;`, `&&`, `||`, `|`, `&`, newlines), each as its words. */
function segments(command: string): string[][] {
  return command
    .split(/&&|\|\||[;|&\n]/)
    .map((s) =>
      s
        .trim()
        .split(/\s+/)
        .filter((w) => w !== ""),
    )
    .filter((s) => s.length > 0);
}

/** A word as a program name: no quotes, no folder, no `\` alias escape, no `.exe`, lowercase. */
const program = (word: string) =>
  (
    word
      .replace(/^["'\\]+|["']+$/g, "")
      .split(/[\\/]/)
      .at(-1) as string
  )
    .toLowerCase()
    .replace(/\.exe$/, "");

/** The program of a segment and its arguments, past `sudo`, `env X=1` and the like. */
function invocation(segment: string[]): { prog: string; args: string[]; sudo: boolean } {
  let i = 0;
  let sudo = false;
  while (i < segment.length) {
    const word = program(segment[i] as string);
    if (word === "sudo") sudo = true;
    else if (!PREFIXES.has(word) && !/^\w+=/.test(segment[i] as string)) break;
    i++;
  }
  return { prog: program(segment[i] ?? ""), args: segment.slice(i + 1), sudo };
}

/** Short flags (`-fr`) containing `letter`, or one of the long ones. */
const hasFlag = (args: string[], letter: string, long: string[]) =>
  args.some(
    (a) =>
      long.includes(a.toLowerCase()) ||
      (/^-[a-z]+$/i.test(a) && a.slice(1).toLowerCase().includes(letter)),
  );

/** The git subcommand and its arguments, past `-C dir`, `-c k=v` and other global options. */
function gitCommand(args: string[]): { sub: string; rest: string[] } {
  let i = 0;
  while (i < args.length && (args[i] as string).startsWith("-")) {
    i += ["-C", "-c", "--git-dir", "--work-tree"].includes(args[i] as string) ? 2 : 1;
  }
  return { sub: args[i] ?? "", rest: args.slice(i + 1) };
}

/** What one segment of a shell command adds, given whether a pipe feeds it. */
function segmentRisks(segment: string[], piped: boolean): Candidate[] {
  const { prog, args, sudo } = invocation(segment);
  const out: Candidate[] = [];
  if (sudo) out.push(["high", "sudo"]);
  if (piped && SHELLS.has(prog)) out.push(["high", `pipe para ${prog}`]);
  if (prog === "rm" && hasFlag(args, "r", ["--recursive", "-recurse"])) {
    out.push(["high", "rm recursivo"]);
  }
  if (prog === "chmod" && hasFlag(args, "r", ["--recursive"])) out.push(["high", "chmod -R"]);
  if (["del", "erase", "rd", "rmdir"].includes(prog) && args.some((a) => /^\/s$/i.test(a))) {
    out.push(["high", `${prog} /s`]);
  }
  if (prog === "format" && /^[a-z]:/i.test(args[0] ?? "")) out.push(["high", "format de disco"]);
  if (["remove-item", "ri"].includes(prog) && args.some((a) => /^-r(ec\w*)?$/i.test(a))) {
    out.push(["high", "Remove-Item -Recurse"]);
  }
  if (["eval", "iex", "invoke-expression"].includes(prog)) out.push(["high", prog]);
  if (["pwsh", "powershell"].includes(prog) && args.some((a) => /^-(e|ec|en\w*)$/i.test(a))) {
    out.push(["high", "-EncodedCommand"]);
  }
  if (prog === "git") {
    const { sub, rest } = gitCommand(args);
    const force =
      hasFlag(rest, "f", ["--force"]) ||
      rest.some((a) => a.startsWith("--force-with-lease") || a.startsWith("+"));
    if (sub === "push" && force) out.push(["high", "git push forçado"]);
    if (sub === "reset" && rest.includes("--hard")) out.push(["high", "git reset --hard"]);
    if (sub === "clean" && hasFlag(rest, "f", ["--force"])) out.push(["high", "git clean -f"]);
  }
  return out;
}

export class RiskClassifier {
  private readonly extra: RegExp[];

  constructor(readonly opts: RiskOptions) {
    this.extra = (opts.extraHigh ?? []).map((source) => new RegExp(source, "i"));
  }

  classify(toolName: string, input: Record<string, unknown>, cwd: string): Risk {
    const candidates = this.candidates(toolName, input, cwd);
    const [level, reason] = candidates.reduce((a, b) => (RANK[b[0]] > RANK[a[0]] ? b : a));
    return { level, reason, network: this.network(toolName, input) };
  }

  private candidates(toolName: string, input: Record<string, unknown>, cwd: string): Candidate[] {
    const text = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : "");
    if (SHELL_TOOLS.has(toolName)) return this.shell(text("command"), cwd);
    if (toolName === "TodoWrite") return [["low", "lista de tarefas"]];
    const fields = READ_TOOLS[toolName];
    if (fields) {
      const paths = fields.map((f) => text(f) || cwd);
      // Glob's pattern names files; Grep's searches their contents, so only its `glob` counts.
      const patterns = [toolName === "Glob" ? text("pattern") : "", text("glob")].filter(
        (p) => p !== "",
      );
      if ([...paths, ...patterns].some(credential)) return [["high", "caminho de credencial"]];
      return paths.every((p) => this.allowed(p, cwd))
        ? [["low", "leitura dentro do projeto"]]
        : [["medium", "leitura fora do cwd e de allowedRoots"]];
    }
    if (WRITE_TOOLS.has(toolName)) {
      const path = text("file_path") || text("notebook_path");
      if (credential(path)) return [["high", "escrita em caminho de credencial"]];
      return this.allowed(path, cwd)
        ? [["medium", "escrita dentro do projeto"]]
        : [["high", "escrita fora do cwd e de allowedRoots"]];
    }
    if (NETWORK_TOOLS.has(toolName)) return [["medium", "acessa a rede"]];
    if (toolName.startsWith("mcp__")) {
      // Phase 17: a command Claude wrote, with a secret in its environment, from any server.
      if (toolName.endsWith("__run_with_secret")) {
        return [["high", "comando livre com segredo no ambiente"]];
      }
      return /delete|drop|destroy/i.test(toolName)
        ? [["high", "ferramenta MCP destrutiva"]]
        : [["medium", "ferramenta MCP"]];
    }
    return [["medium", "ferramenta que o classificador não conhece"]];
  }

  private shell(command: string, cwd: string): Candidate[] {
    const out: Candidate[] = [["medium", "comando de shell"]];
    // A pipe hands its output to the next command: split on single pipes to know who is fed.
    for (const statement of command.split(/&&|\|\||[;&\n]/)) {
      statement.split("|").forEach((part, i) => {
        for (const segment of segments(part)) out.push(...segmentRisks(segment, i > 0));
      });
    }
    if (/\$\(|`/.test(command)) out.push(["high", "substituição de comando"]);
    if (/(^|\s)-encodedcommand(\s|$)/i.test(command)) out.push(["high", "-EncodedCommand"]);
    if (/\bbase64\b[^|;&\n]*\s(-d|-D|--decode)\b[^|;&\n]*\|/.test(command)) {
      out.push(["high", "base64 -d em pipe"]);
    }
    for (const match of command.matchAll(
      /(?:^|[^>&<=-])\d?>{1,2}\s*("[^"]*"|'[^']*'|[^\s;&|<>]+)/g,
    )) {
      const target = (match[1] as string).replace(/^["']|["']$/g, "");
      if (SINKS.has(target.toLowerCase())) continue;
      if (/[$%]/.test(target) || !this.inside(target, cwd, [])) {
        out.push(["high", "redirecionamento para fora do cwd"]);
      }
    }
    if (words(command).some(credential)) out.push(["high", "caminho de credencial"]);
    if (this.extra.some((re) => re.test(command))) out.push(["high", "padrão de risk.extraHigh"]);
    return out;
  }

  private network(toolName: string, input: Record<string, unknown>): boolean {
    if (NETWORK_TOOLS.has(toolName) || toolName.startsWith("mcp__")) return true;
    if (!SHELL_TOOLS.has(toolName)) return false;
    return segments(String(input.command ?? "")).some((segment) => {
      const { prog, args } = invocation(segment);
      const sub = prog === "git" ? gitCommand(args).sub : "";
      return NETWORK_PROGRAMS.has(prog) || ["push", "pull", "fetch", "clone"].includes(sub);
    });
  }

  /** Inside the cwd or one of `allowedRoots`. */
  private allowed(path: string, cwd: string): boolean {
    return this.inside(path, cwd, this.opts.allowedRoots);
  }

  private inside(path: string, cwd: string, roots: readonly string[]): boolean {
    const home = /^~(?=$|[\\/])/.test(path) ? join(this.opts.home, path.slice(1)) : path;
    const full = resolve(cwd, home);
    return [cwd, ...roots].some((root) => isInside(resolve(root), full));
  }
}
