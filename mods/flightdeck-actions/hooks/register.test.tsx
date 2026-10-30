import { expect, test } from "claude-code/testing";

const BAND = {
  plugin: "flightdeck-actions",
  component: "AbovePrompt",
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 5,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 5 },
    view: {},
  },
} as const;

const LISTED = JSON.stringify({
  actions: [
    {
      name: "deploy-staging",
      description: "Deploy the branch to staging",
      approval: "first-per-session",
      params: { branch: { pattern: "^[a-z]+$", default: "main" } },
    },
  ],
});

/** `/flightdeck-actions` typed at the prompt, as the engine raises it. */
const LISTING = {
  command: "flightdeck-actions",
  args: "",
  origin: { kind: "composer" },
  presentation: { isFullscreen: false, columns: 80 },
} as const;

const RESULT = (over: Record<string, unknown> = {}) => ({
  exitCode: 0,
  stdout: "",
  stderr: "",
  isStdoutTruncated: false,
  isStderrTruncated: false,
  ...over,
});

test("registers the four tools and the command", async ($, on) => {
  const tools: string[] = [];
  const commands: string[] = [];
  on("tool.register", (_, e) => {
    tools.push(e.name);
    return { value: { tool: e.name } };
  });
  on("command.register", (_, e) => {
    commands.push(e.name);
    return { value: { command: e.name } };
  });
  on("session.start", (_, e) => ({ cwd: e.cwd }));

  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });

  expect(tools).toEqual(["list_actions", "run_action", "list_snippets", "get_snippet"]);
  expect(commands).toEqual(["flightdeck-actions"]);
});

test("list_actions asks flightdeckd and hands the model what it printed", async ($, on) => {
  const argvs: string[][] = [];
  on("process.run", (_, e) => {
    argvs.push([...e.argv]);
    return { value: RESULT({ stdout: LISTED }) };
  });
  on("tool.call", () => ({ result: {} }));

  const answer = await $.tool.call({
    tool: "mcp__flightdeck-actions__list_actions",
    projectId: "p1",
  });

  expect(argvs).toEqual([["flightdeckd", "action", "list", "--project", "p1"]]);
  expect(String(answer.result)).toContain("deploy-staging");
});

test("run_action passes the name and the parameters as arguments, never a shell line", async ($, on) => {
  const argvs: string[][] = [];
  on("process.run", (_, e) => {
    argvs.push([...e.argv]);
    return { value: RESULT({ stdout: '{"exitCode":0,"output":"•••(token)\\n"}' }) };
  });
  on("tool.call", () => ({ result: {} }));

  const answer = await $.tool.call({
    tool: "mcp__flightdeck-actions__run_action",
    name: "deploy-staging",
    params: { branch: "main; rm -rf /" },
  });

  expect(argvs).toEqual([
    ["flightdeckd", "action", "run", "deploy-staging", "--param", "branch=main; rm -rf /"],
  ]);
  expect(String(answer.result)).toContain("•••(token)");
});

test("a failing flightdeckd comes back to the model as the error text", async ($, on) => {
  on("process.run", () => ({ value: RESULT({ exitCode: 1, stderr: "bad_request: parâmetro" }) }));
  on("tool.call", () => ({ result: {} }));

  const answer = await $.tool.call({
    tool: "mcp__flightdeck-actions__run_action",
    name: "deploy-staging",
  });

  expect((answer as { deny?: string }).deny).toContain("bad_request");
});

test("the band names the action while it runs and goes away after", async ($, on) => {
  let finish: (() => void) | undefined;
  // The mod writes the running state and only then calls process.run, so once this hook is
  // reached the state is there: the test waits for that event, not for a time.
  const reached = Promise.withResolvers<void>();
  on("process.run", async () => {
    reached.resolve();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { value: RESULT({ stdout: "{}" }) };
  });
  on("tool.call", () => ({ result: {} }));
  // The engine's own band draws nothing; the mod's text is the only Text.
  on("ui.render", ($, e) => {
    const { Box } = $.ui.resolve(e);
    return <Box />;
  });

  const call = $.tool.call({ tool: "mcp__flightdeck-actions__run_action", name: "deploy-staging" });
  await reached.promise;

  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount({ ...BAND, surface });
    expect((await ui.find({ type: "Text" }))?.text).toContain("deploy-staging");
    await ui.unmount();
  }
  finish?.();
  await call;

  const after = await $.ui.mount({ ...BAND, surface: "terminal" });
  expect(await after.find({ type: "Text", text: /deploy-staging/ })).toBeUndefined();
  await after.unmount();
});

test("a flightdeckd that cannot start is an error for the model, not a crash", async ($, on) => {
  on("process.run", () => {
    throw new Error("spawn flightdeckd ENOENT");
  });
  on("tool.call", () => ({ result: {} }));

  for (const tool of ["list_actions", "run_action"]) {
    const answer = await $.tool.call({
      tool: `mcp__flightdeck-actions__${tool}`,
      name: "deploy-staging",
    });

    expect((answer as { deny?: string }).deny).toContain("flightdeckd");
  }
});

test("/flightdeck-actions lists each trusted action with its description and approval", async ($, on) => {
  const argvs: string[][] = [];
  on("process.run", (_, e) => {
    argvs.push([...e.argv]);
    return { value: RESULT({ stdout: LISTED }) };
  });

  const done = await $.command.run(LISTING);

  expect(argvs).toEqual([["flightdeckd", "action", "list"]]);
  expect(done.text).toBe("deploy-staging: Deploy the branch to staging (first-per-session)");
});

test("/flightdeck-actions says when no action is trusted, and shows flightdeckd's error", async ($, on) => {
  let reply = RESULT({ stdout: JSON.stringify({ actions: [] }) });
  on("process.run", () => ({ value: reply }));

  expect((await $.command.run(LISTING)).text).toBe(
    "No Flightdeck actions are trusted on this host.",
  );
  reply = RESULT({ exitCode: 1, stderr: "could not connect\n" });
  expect((await $.command.run(LISTING)).text).toBe("flightdeck-actions: could not connect");
});

test("list_snippets reads the snippets of the session's project through flightdeckd, with the query", async ($, on) => {
  const argvs: string[][] = [];
  on("process.run", (_, e) => {
    argvs.push([...e.argv]);
    return { value: RESULT({ stdout: '{"snippets":[{"name":"status"}]}' }) };
  });
  on("tool.register", (_, e) => ({ value: { tool: e.name } }));
  on("command.register", (_, e) => ({ value: { command: e.name } }));
  on("tool.call", () => ({ result: {} }));
  await $.session.start({ cwd: "/work/app", surface: "terminal", isInteractive: true });

  const answer = await $.tool.call({
    tool: "mcp__flightdeck-actions__list_snippets",
    query: "git",
  });

  expect(argvs).toEqual([
    ["flightdeckd", "snippet", "list", "--project-path", "/work/app", "--query", "git"],
  ]);
  expect(String(answer.result)).toContain("status");
});

test("get_snippet reads one snippet by name and never runs it; flightdeckd's error comes back", async ($, on) => {
  const argvs: string[][] = [];
  let reply = RESULT({ stdout: '{"name":"revisar","text":"Revise {{file}}"}' });
  on("process.run", (_, e) => {
    argvs.push([...e.argv]);
    return { value: reply };
  });
  on("tool.call", () => ({ result: {} }));

  const answer = await $.tool.call({
    tool: "mcp__flightdeck-actions__get_snippet",
    name: "revisar",
  });

  expect(argvs).toEqual([["flightdeckd", "snippet", "get", "revisar"]]);
  expect(String(answer.result)).toContain("Revise {{file}}");
  reply = RESULT({ exitCode: 1, stderr: "not_found: snippet\n" });
  const missing = await $.tool.call({ tool: "mcp__flightdeck-actions__get_snippet", name: "nada" });
  expect((missing as { deny?: string }).deny).toContain("not_found");
});
