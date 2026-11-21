import { isExpanded, runsFlightdeckWords } from "./shell-call.ts";
import { onlyTurnsOff } from "./watch-risk.ts";

/** The flags that only choose the daemon or the output, and change nothing. */
const READING_FLAGS = ["--json", "--host", "--config"];

/**
 * `mcp test --confirm` starts the command a project's .mcp.json names, `mcp remove` deletes a server from
 * that file and `mcp toggle --enable` lets one run in the project's sessions (#3616): the app has the person
 * read the command first. From a shell `--confirm` is only a typed word. The preview test (no flag), the
 * reads and turning a server off grant a session nothing, so they stay ordinary. A test is read by what it is
 * not (no flag outside the reading ones), so a flag a later version adds, `--confirm=1` or a word the shell
 * expands is high too.
 */
function changesAnMcpServer(prog: string, args: string[]): boolean {
  return runsFlightdeckWords(prog, args, ([command, action], own) => {
    if (command !== "mcp") return false;
    if (action === "remove") return true;
    if (action === "toggle") return !onlyTurnsOff(own, "--disable");
    if (action !== "test") return false;
    return own.some((w) => isExpanded(w) || (w.startsWith("--") && !READING_FLAGS.includes(w)));
  });
}

/** The `mcp` verbs that are high from a shell, with what each is stopped for. */
export const MCP_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: changesAnMcpServer,
    reason: () =>
      "starts or changes an MCP server of a project, a command the project's .mcp.json names, without the person choosing it in the app; a typed --confirm is not the person (flightdeckd mcp test --confirm, remove or toggle)",
  },
];
