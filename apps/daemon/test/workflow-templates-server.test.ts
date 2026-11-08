import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type {
  HarnessStack,
  WorkflowInfo,
  WorkflowTemplate,
  WorkflowTemplateAdded,
} from "@flightdeck/protocol";
import type { PrProvider } from "../src/board/pr.ts";
import { startServer } from "../src/server.ts";
import { git } from "./board-helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { workflowCard } from "./workflow-helpers.ts";

// Real git in a temporary repository: more than the default 5 s.
setDefaultTimeout(20_000);

const TOKEN = "workflow-templates-token-0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const STACK: HarnessStack = {
  stacks: ["node"],
  commands: { test: "bun run test", lint: null, format: null, build: null },
};

async function serve(
  harnessStack?: (path: string) => Promise<HarnessStack>,
  prHost?: Pick<PrProvider, "create">,
) {
  const ctx = await workflowCard(
    "steps:\n  - id: lint\n    check: fd-lint\n",
    prHost ? { prProvider: "github", board: { prProvider: () => prHost as PrProvider } } : {},
  );
  // The person's identity: the template's branch is theirs to push.
  git(ctx.repo, "config", "user.name", "Ana");
  git(ctx.repo, "config", "user.email", "ana@example.com");
  cleanups.push(() => ctx.board.stop());
  const server = startServer({
    manager: ctx.manager,
    board: ctx.board,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [ctx.root],
    ...(harnessStack ? { harnessStack } : {}),
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return { client, project: ctx.project, repo: ctx.repo };
}

const fixerCheck = (templates: WorkflowTemplate[] | undefined) =>
  templates?.find((template) => template.id === "alert-fixer");

describe("workflow.templates (issue #79)", () => {
  test("lists the templates, the alert fixer's check line filled from the project's stack", async () => {
    const asked: string[] = [];
    const { client, project, repo } = await serve(async (path) => {
      asked.push(path);
      return STACK;
    });
    const result = await client.data<{ templates: WorkflowTemplate[] }>("workflow.templates", {
      projectId: project.id,
    });
    expect(result?.templates.map((template) => template.id)).toEqual([
      "tech-debt-scan",
      "alert-fixer",
      "post-mortem",
    ]);
    expect(fixerCheck(result?.templates)?.checkFilled).toBe(true);
    expect(fixerCheck(result?.templates)?.yaml.includes("bun run test")).toBe(true);
    expect(asked).toEqual([repo]);
  });

  test("a host with no stack detection keeps the placeholder", async () => {
    const { client, project } = await serve();
    const result = await client.data<{ templates: WorkflowTemplate[] }>("workflow.templates", {
      projectId: project.id,
    });
    expect(fixerCheck(result?.templates)?.checkFilled).toBe(false);
  });

  test("a stack that cannot be read keeps the placeholder instead of failing the list", async () => {
    const { client, project } = await serve(async () => {
      throw new Error("unreadable");
    });
    const result = await client.data<{ templates: WorkflowTemplate[] }>("workflow.templates", {
      projectId: project.id,
    });
    expect(result?.templates.length).toBe(3);
    expect(fixerCheck(result?.templates)?.checkFilled).toBe(false);
  });

  test("a project with no test command keeps the placeholder", async () => {
    const { client, project } = await serve(async () => ({
      stacks: [],
      commands: { test: null, lint: null, format: null, build: null },
    }));
    const result = await client.data<{ templates: WorkflowTemplate[] }>("workflow.templates", {
      projectId: project.id,
    });
    expect(fixerCheck(result?.templates)?.checkFilled).toBe(false);
  });

  test("a project that does not exist is refused with its reason", async () => {
    const { client } = await serve(async () => STACK);
    const refused = await client.request("workflow.templates", { projectId: "nope" });
    expect(refused).toMatchObject({
      ok: false,
      error: { code: "not_found", reason: "project_not_found" },
    });
  });
});

describe("workflow.template.add (issue #1221)", () => {
  const URL = "https://github.com/o/r/pull/9";

  test("the host offers it, and adds a template on a new branch with its PR while the base keeps its workflows", async () => {
    const asked: string[] = [];
    const { client, project } = await serve(async () => STACK, {
      create: async (opts) => {
        asked.push(`${opts.base} <- ${opts.head}`);
        return URL;
      },
    });
    const info = await client.data<{ features: string[] }>("host.info", {});
    expect(info?.features.includes("workflowTemplateAdd")).toBe(true);
    const added = await client.data<WorkflowTemplateAdded>("workflow.template.add", {
      projectId: project.id,
      templateId: "alert-fixer",
      confirm: true,
    });
    expect([added?.path, added?.base, added?.url]).toEqual([
      ".flightdeck/workflows/alert-fixer.yaml",
      "main",
      URL,
    ]);
    expect(asked).toEqual([`main <- ${added?.branch ?? ""}`]);
    const listed = await client.data<{ workflows: WorkflowInfo[] }>("workflow.list", {
      projectId: project.id,
    });
    expect(listed?.workflows.map((w) => w.name)).toEqual(["wf"]);
  });

  test("without confirm, or for a template the host does not have, it is refused with its reason", async () => {
    const { client, project } = await serve(async () => STACK, { create: async () => URL });
    const reasonOf = async (payload: Record<string, unknown>) => {
      const answer = await client.request("workflow.template.add", {
        projectId: project.id,
        ...payload,
      });
      return (answer as { error?: { reason?: string } }).error?.reason ?? "ok";
    };
    expect([
      await reasonOf({ templateId: "alert-fixer" }),
      await reasonOf({ templateId: "nope", confirm: true }),
    ]).toEqual(["workflow_template_confirm", "workflow_template_unknown"]);
  });
});
