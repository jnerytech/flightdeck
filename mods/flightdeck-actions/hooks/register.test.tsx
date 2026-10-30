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

const RESULT = (over: Record<string, unknown> = {}) => ({
  exitCode: 0,
  stdout: "",
  stderr: "",
  isStdoutTruncated: false,
  isStderrTruncated: false,
  ...over,
});

test("registers the two tools and the command", async ($, on) => {
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

  expect(tools).toEqual(["list_actions", "run_action"]);
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
  expect(answer.text).toContain("deploy-staging");
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
  expect(answer.text).toContain("•••(token)");
});

test("a failing flightdeckd comes back to the model as the error text", async ($, on) => {
  on("process.run", () => ({ value: RESULT({ exitCode: 1, stderr: "bad_request: parâmetro" }) }));
  on("tool.call", () => ({ result: {} }));

  const answer = await $.tool.call({
    tool: "mcp__flightdeck-actions__run_action",
    name: "deploy-staging",
  });

  expect(answer.text).toContain("bad_request");
  expect(answer.isError).toBe(true);
});

test("the band names the action while it runs and goes away after", async ($, on) => {
  let finish: (() => void) | undefined;
  on("process.run", async () => {
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
  await Promise.resolve();

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
