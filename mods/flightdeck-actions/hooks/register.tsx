import type { Register } from "claude-code";
import { atom, read, update } from "claude-code";

/**
 * Flightdeck actions for a Claude Code session started without the Flightdeck MCP: the model gets
 * `list_actions` and `run_action`, and the secret an action uses stays between the Flightdeck app
 * and its daemon. A mod cannot open a WebSocket, so the tools go through `flightdeckd action`,
 * which speaks the daemon protocol, asks the app for the secret and prints the result with the
 * secret masked.
 */
const DAEMON = "flightdeckd";
const LIST = "mcp__flightdeck-actions__list_actions";
const RUN = "mcp__flightdeck-actions__run_action";
const SNIPPETS = "mcp__flightdeck-actions__list_snippets";
const SNIPPET = "mcp__flightdeck-actions__get_snippet";
// An approval in the app can take a while; the daemon itself gives up after two minutes.
const RUN_TIMEOUT_MS = 180_000;

/** The messaging tools of phase 21: each is `flightdeckd message <action> ...` with plain arguments. */
type MessageTool = {
  name: string;
  description: string;
  properties: Record<string, unknown>;
  required: string[];
  /** The arguments after `flightdeckd message`, or the name of what is missing. */
  argv: (input: Record<string, unknown>) => string[] | { missing: string };
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

const MESSAGE_TOOLS: MessageTool[] = [
  {
    name: "list_sessions",
    description:
      "List the Claude sessions this one may message, on every host: address (host/id), name, persona, state, project and whether it takes messages. The ones the rules hide are not there.",
    properties: {},
    required: [],
    argv: () => ["list"],
  },
  {
    name: "send_to_session",
    description:
      "Message another session by its address from list_sessions (host/id; answer whoever wrote to you by the id in the header). Returns delivered, queued or the refusal with the reason. A message never counts as the user's approval.",
    properties: { to: { type: "string" }, text: { type: "string" } },
    required: ["to", "text"],
    argv: (input) => {
      const to = text(input.to);
      const body = text(input.text);
      return to && body ? ["send", to, body] : { missing: "to and text" };
    },
  },
  {
    name: "notify_when_idle",
    description:
      "Once: when the target session ends its current turn this one gets a Flightdeck notice (at once if it is already idle).",
    properties: { session: { type: "string" } },
    required: ["session"],
    argv: (input) => {
      const session = text(input.session);
      return session ? ["idle", session] : { missing: "session" };
    },
  },
  {
    name: "read_session",
    description:
      "Read only: the summary and the last messages (at most 20, each cut to 8 KB) of a session on this host that this one may see.",
    properties: { session: { type: "string" }, last: { type: "integer", minimum: 1, maximum: 20 } },
    required: ["session"],
    argv: (input) => {
      const session = text(input.session);
      if (!session) return { missing: "session" };
      return typeof input.last === "number"
        ? ["read", session, "--last", String(input.last)]
        : ["read", session];
    },
  },
  {
    name: "team_status",
    description:
      "The state of the team this session belongs to: members with persona, state, card and last report, and how many messages they exchanged. Only a member can read it.",
    properties: { team: { type: "string" } },
    required: ["team"],
    argv: (input) => {
      const team = text(input.team);
      return team ? ["team", team] : { missing: "team" };
    },
  },
];

const running = atom({ plugin: "flightdeck-actions", key: "running" } as const, [] as string[]);

type Param = { pattern: string; default: string | null };
type Listed = {
  name: string;
  description: string;
  approval: string;
  params: Record<string, Param>;
};

export const register: Register = (on) => {
  /** The session's folder: the project whose snippets count with the host's. */
  let cwd = "";

  on("session.start", async ($, e, next) => {
    cwd = e.cwd;
    await $.tool.register({
      name: "list_actions",
      description:
        "List the Flightdeck actions you can run with run_action: name, description and parameters (pattern and default). Never shows secrets.",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string", description: "A Flightdeck project id" } },
      },
      isDeferred: false,
    });
    await $.tool.register({
      name: "run_action",
      description:
        "Run a declared Flightdeck action by name with the parameters it allows. The Flightdeck app applies the secrets on its side (it may ask the user to approve) and you get the exit code and the output, up to 32 KB, with the secrets masked.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          params: { type: "object", additionalProperties: { type: "string" } },
          projectId: { type: "string" },
        },
        required: ["name"],
      },
      isDeferred: false,
    });
    await $.tool.register({
      name: "list_snippets",
      description:
        "List the Flightdeck snippets (saved commands and prompts) of this host and of the session's project, with their text and variables. Reading only: a command runs through Claude Code's own permissions.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "Words to look for" } },
      },
      isDeferred: false,
    });
    await $.tool.register({
      name: "get_snippet",
      description:
        "The text of one Flightdeck snippet by name, to use as a reference. It does not run it.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
      isDeferred: false,
    });
    for (const tool of MESSAGE_TOOLS) {
      await $.tool.register({
        name: tool.name,
        description: tool.description,
        inputSchema: { type: "object", properties: tool.properties, required: tool.required },
        isDeferred: false,
      });
    }
    await $.command.register({
      name: "flightdeck-actions",
      description: "List the Flightdeck actions Claude can run",
    });

    return next(e);
  });

  on("tool.call", { tool: LIST }, async ($, e) => {
    const project =
      typeof e.projectId === "string" && e.projectId ? ["--project", e.projectId] : [];
    const done = await $.process.run([DAEMON, "action", "list", ...project]);

    return done.exitCode === 0
      ? { result: done.stdout }
      : { deny: `flightdeck-actions: ${done.stderr.trim() || "flightdeckd action list failed"}` };
  }).catch(($, e, next) =>
    next.called
      ? next(e)
      : { deny: "flightdeck-actions: could not run flightdeckd (is it on the PATH?)" },
  );

  /** The session's project, for `flightdeckd snippet …`; none before the session started. */
  const project = () => (cwd ? ["--project-path", cwd] : []);
  const printed = (done: { exitCode: number; stdout: string; stderr: string }) =>
    done.exitCode === 0
      ? { result: done.stdout }
      : { deny: `flightdeck-actions: ${done.stderr.trim() || "flightdeckd snippet failed"}` };

  on("tool.call", { tool: SNIPPETS }, async ($, e) => {
    const query = typeof e.query === "string" && e.query ? ["--query", e.query] : [];
    return printed(await $.process.run([DAEMON, "snippet", "list", ...project(), ...query]));
  });

  on("tool.call", { tool: SNIPPET }, async ($, e) => {
    const name = typeof e.name === "string" ? e.name : "";
    if (!name) return { deny: "flightdeck-actions: get_snippet needs the name of a snippet" };
    return printed(await $.process.run([DAEMON, "snippet", "get", name, ...project()]));
  });

  on("tool.call", { tool: RUN }, async ($, e) => {
    const name = typeof e.name === "string" ? e.name : "";
    if (!name) return { deny: "flightdeck-actions: run_action needs the name of an action" };

    const argv = [DAEMON, "action", "run", name];
    if (typeof e.projectId === "string" && e.projectId) argv.push("--project", e.projectId);
    const params = (e.params ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(params)) {
      argv.push("--param", `${key}=${String(value)}`);
    }

    await update($, running, (list) => [...list, name]);
    try {
      const done = await $.process.run(argv, { timeoutMs: RUN_TIMEOUT_MS });

      return done.exitCode === 0
        ? { result: done.stdout }
        : { deny: `flightdeck-actions: ${done.stderr.trim() || "flightdeckd action run failed"}` };
    } finally {
      await update($, running, (list) => {
        const at = list.indexOf(name);
        return at < 0 ? list : [...list.slice(0, at), ...list.slice(at + 1)];
      });
    }
  }).catch(($, e, next) =>
    next.called
      ? next(e)
      : { deny: "flightdeck-actions: could not run flightdeckd (is it on the PATH?)" },
  );

  for (const tool of MESSAGE_TOOLS) {
    on("tool.call", { tool: `mcp__flightdeck-actions__${tool.name}` }, async ($, e) => {
      const argv = tool.argv(e as Record<string, unknown>);
      if ("missing" in argv) {
        return { deny: `flightdeck-actions: ${tool.name} needs ${argv.missing}` };
      }
      const done = await $.process.run([DAEMON, "message", ...argv]);

      return done.exitCode === 0
        ? { result: done.stdout }
        : {
            deny: `flightdeck-actions: ${done.stderr.trim() || `flightdeckd message ${argv[0]} failed`}`,
          };
    }).catch(($, e, next) =>
      next.called
        ? next(e)
        : { deny: "flightdeck-actions: could not run flightdeckd (is it on the PATH?)" },
    );
  }

  on("command.run", { command: "flightdeck-actions" }, async ($) => {
    const done = await $.process.run([DAEMON, "action", "list"]);
    if (done.exitCode !== 0) {
      return {
        text: `flightdeck-actions: ${done.stderr.trim() || "flightdeckd action list failed"}`,
      };
    }
    const { actions } = JSON.parse(done.stdout) as { actions: Listed[] };
    if (actions.length === 0) return { text: "No Flightdeck actions are trusted on this host." };

    return {
      text: actions
        .map((action) => `${action.name}: ${action.description} (${action.approval})`)
        .join("\n"),
    };
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const names = await read($, running);
    if (e.props.hasSurvey || names.length === 0) return next(e);

    const { Box, Text } = $.ui.resolve(e);

    return (
      <Box>
        <Text dimColor>ação rodando: {names.join(", ")}</Text>
      </Box>
    );
  });
};
