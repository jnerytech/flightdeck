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
// An approval in the app can take a while; the daemon itself gives up after two minutes.
const RUN_TIMEOUT_MS = 180_000;

const running = atom({ plugin: "flightdeck-actions", key: "running" } as const, [] as string[]);

type Param = { pattern: string; default: string | null };
type Listed = {
  name: string;
  description: string;
  approval: string;
  params: Record<string, Param>;
};

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
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
