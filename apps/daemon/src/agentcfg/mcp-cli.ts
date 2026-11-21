/**
 * Issue #3616: `flightdeckd mcp`, a project's MCP servers and the state they report in a live session (the
 * app's Agent setup screen). `list`, `status` and `test` without `--confirm` only read: the daemon answers a
 * test with the command or URL it would run and starts nothing. `test --confirm` starts the server, `remove`
 * deletes it from the project's .mcp.json and `toggle` turns it on or off; a daemon that does not answer one
 * of the last two leaves its result unknown. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { readFile } from "node:fs/promises";
import {
  type CliResult,
  failure,
  type RemoteTarget,
  resolveProject,
  runOnLocalDaemon,
  shown,
} from "../daemon-client/index.ts";
import {
  listLines,
  previewJson,
  previewLine,
  serverJson,
  statusJson,
  statusLines,
  testJson,
  testLines,
} from "./domain/mcp-cli-view.ts";
import { serverFromText } from "./domain/mcp-input.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

/** What a write that got no answer may have done, and where to look. */
const UNSURE =
  "; the change may or may not have been made: check with `mcp list` before trying again";

/** A project (its name or its id) and a server's name, or a session's id, by the action. */
export type McpCliArgs = { json?: boolean } & (
  | { action: "list"; project: string }
  | { action: "status"; session: string }
  | { action: "test"; project: string; server: string; confirm?: true }
  | { action: "save"; project: string; file: string }
  | { action: "remove"; project: string; server: string }
  | { action: "toggle"; project: string; server: string; enabled: boolean; session?: string }
);

/** The server the file describes (`-` is standard input), or what is wrong with reading it. */
async function readServer(
  file: string,
  stdin: ReadableStream<Uint8Array>,
): Promise<ReturnType<typeof serverFromText>> {
  let text: string;
  try {
    text = file === "-" ? await new Response(stdin).text() : await readFile(file, "utf8");
  } catch {
    return { problem: `cannot read the server from ${file}` };
  }
  return serverFromText(text);
}

export async function runMcpCli(
  args: McpCliArgs,
  config: { bind: string; port: number; token: string },
  options: {
    timeoutMs?: number;
    remote?: RemoteTarget;
    stdin?: ReadableStream<Uint8Array> | undefined;
  } = {},
): Promise<CliResult> {
  // A save reads its file first: a refused file is exit 1 with no daemon asked, and `-` holds no connection open.
  const saved =
    args.action === "save"
      ? await readServer(args.file, options.stdin ?? Bun.stdin.stream())
      : undefined;
  if (saved && "problem" in saved) return failure(1, `mcp save: ${saved.problem}`);
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-mcp",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    unsure: UNSURE,
    perform: async (daemon, note) => {
      if (args.action === "status") {
        const { servers } = await daemon.call("mcp.status", { sessionId: args.session });
        return shown(args.json, { servers: servers.map(statusJson) }, () => statusLines(servers));
      }
      const { projects } = await daemon.call("project.list", {});
      const chosen = resolveProject(projects, args.project);
      if ("refusal" in chosen) return chosen.refusal;
      const projectId = chosen.id;
      if (args.action === "list") {
        const { servers } = await daemon.call("mcp.list", { projectId });
        return shown(args.json, { servers: servers.map(serverJson) }, () => listLines(servers));
      }
      if (args.action === "save") {
        // `saved` holds the server whenever the action is a save: the guard before this call returned any problem.
        if (!saved || !("server" in saved)) return failure(1, "mcp save: no server to save");
        note.wrote = true;
        const { servers } = await daemon.call("mcp.save", {
          projectId,
          server: saved.server,
          confirm: true,
        });
        return shown(args.json, { servers: servers.map(serverJson) }, () => [
          `saved ${saved.server.name}`,
          ...listLines(servers),
        ]);
      }
      if (args.action === "remove" || args.action === "toggle") {
        note.wrote = true;
        const { servers } =
          args.action === "remove"
            ? await daemon.call("mcp.remove", { projectId, name: args.server, confirm: true })
            : await daemon.call("mcp.toggle", {
                projectId,
                name: args.server,
                enabled: args.enabled,
                confirm: true,
                ...(args.session === undefined ? {} : { sessionId: args.session }),
              });
        const removed = args.action === "remove" ? [`removed ${args.server}`] : [];
        return shown(args.json, { servers: servers.map(serverJson) }, () => [
          ...removed,
          ...listLines(servers),
        ]);
      }
      const confirm = args.confirm === true;
      const tested = await daemon.call("mcp.test", {
        projectId,
        name: args.server,
        ...(confirm ? { confirm } : {}),
      });
      if (confirm) {
        if ("preview" in tested) return failure(1, "the daemon did not start the server");
        return shown(args.json, testJson(tested), () => testLines(tested));
      }
      if (!("preview" in tested))
        return failure(1, "the daemon started the server: this command only reads");
      const { preview } = tested;
      return shown(args.json, { preview: previewJson(preview) }, () => [previewLine(preview)]);
    },
  });
}
