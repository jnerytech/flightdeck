import { RANK, READ_TOOLS, type RiskLevel, SHELL_TOOLS, WRITE_TOOLS } from "./risk.ts";

/** What the daemon thinks of one tool call: its own classifier, behind a function. */
export type ClassifyCall = (toolName: string, input: Record<string, unknown>) => RiskLevel;

/** Arguments that make a program high when it has a destructive form: `rm -rf`, `git push --force`. */
const DESTRUCTIVE_ARGS = [
  "-rf /",
  "-R /",
  "/s /q",
  "-Recurse -Force",
  "push --force",
  "reset --hard",
  "clean -fd",
];
/** Only a PowerShell is handed an encoded command: for any other program the word is not run. */
const ENCODED = "-EncodedCommand x";
/** Paths no rule may reach from a request that is not high: a credential, and outside the project. */
const SENSITIVE_PATHS = ["~/.ssh/id_rsa", "/etc/passwd"];

const highest = (levels: RiskLevel[]): RiskLevel =>
  levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "low" as RiskLevel);

/** A shell rule's content as the command it names, and whether anything may follow it. */
function shellPrefix(content: string | undefined): { prefix: string; open: boolean } {
  if (content === undefined) return { prefix: "", open: true };
  const open = content.includes("*");
  const prefix = content.replace(/(:\*|\s\*|\*)$/, "").trim();
  return { prefix, open };
}

/** The input a path rule would let through, with each wildcard read as an ordinary character. */
const pathOf = (content: string) => content.replaceAll(/[*?]+/g, "x");

/**
 * The most risk a rule `toolName(content)` could cover: the daemon's classifier on the calls the
 * rule matches, with the worst arguments or paths a wildcard lets in. `content` undefined is a
 * rule for the whole tool. A saved rule must not cover more than the request it came from.
 */
export function ruleLevel(
  toolName: string,
  content: string | undefined,
  classify: ClassifyCall,
): RiskLevel {
  if (SHELL_TOOLS.has(toolName)) {
    const { prefix, open } = shellPrefix(content);
    const program = (prefix.split(/\s+/)[0] ?? "").toLowerCase().replace(/\.exe$/, "");
    const args =
      prefix === "" || ["pwsh", "powershell"].includes(program)
        ? [...DESTRUCTIVE_ARGS, ENCODED]
        : DESTRUCTIVE_ARGS;
    const commands = [prefix, ...(open ? args.map((a) => `${prefix} ${a}`.trim()) : [])];
    return highest(
      commands.filter((c) => c !== "").map((command) => classify(toolName, { command })),
    );
  }
  const fields = READ_TOOLS[toolName];
  if (fields || WRITE_TOOLS.has(toolName)) {
    const keys = fields ?? ["file_path"];
    const paths =
      content === undefined
        ? SENSITIVE_PATHS
        : [
            pathOf(content),
            ...(content.startsWith("*") || content.includes("..") ? SENSITIVE_PATHS : []),
          ];
    return highest(
      paths.map((path) => classify(toolName, Object.fromEntries(keys.map((key) => [key, path])))),
    );
  }
  return classify(toolName, {});
}
