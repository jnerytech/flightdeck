import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Template, TemplateStartResult } from "@flightdeck/protocol";
import { startServer } from "../src/server.ts";
import { BUILTIN_TEMPLATES } from "../src/templates/builtin.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "t".repeat(32);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const both = (en: string, ptBr = `${en} (pt)`) => ({ en, "pt-BR": ptBr });

/** A host template the tests add to the built-ins. */
const custom = (over: Partial<Template> = {}): Template => ({
  id: "edit-notes",
  title: both("Tidy the notes"),
  description: both("Tidies the notes in a folder."),
  icon: "notebook",
  fields: [{ id: "folder", kind: "folder", label: both("Folder") }],
  prompt: both("Tidy the notes in {folder}.", "Arrume as notas em {folder}."),
  preset: "edit_folder",
  planFirst: false,
  ...over,
});

/** Given a host with the built-ins and these templates, a folder it allows and one it does not. */
async function setup(extra: Template[] = []) {
  const { manager, store, root, project } = newManager();
  const outside = tempDir();
  const server = startServer({
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [root],
    manager,
    templates: async () => ({ templates: [...BUILTIN_TEMPLATES, ...extra], problems: [] }),
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  const start = (payload: Record<string, unknown>) => client.request("template.start", payload);
  const events = (sessionId: string) =>
    (
      store.db
        .query("SELECT payload FROM events WHERE session_id = ? ORDER BY seq")
        .all(sessionId) as Array<{ payload: string }>
    ).map((row) => JSON.parse(row.payload) as Record<string, unknown>);
  const created = (sessionId: string) =>
    events(sessionId).find((e) => e.type === "session.created") as {
      permissionMode: string;
      cwd: string;
    };
  const asked = (sessionId: string) =>
    (events(sessionId).find((e) => e.type === "message.user") as { text: string } | undefined)
      ?.text ?? "";
  return { client, start, created, asked, root, project, outside, manager };
}

const refusal = (ack: Record<string, unknown>) =>
  ack.error as { code: string; reason?: string; params?: Record<string, unknown> };

describe("templates-start: a task from a template", () => {
  test("Given summarise-folder and a folder the host allows, When it starts in English, Then the task reads the folder, asks in plain words and the results folder exists", async () => {
    const { start, created, asked, project } = await setup();
    const ack = await start({
      templateId: "summarise-folder",
      language: "en",
      values: { folder: project, focus: "the budget" },
    });
    expect(ack.ok).toBe(true);
    const result = ack.data as TemplateStartResult;
    expect(result.workingFolder).toBe(project);
    expect(result.outputFolder).toBe(join(project, "Flightdeck results"));
    expect(existsSync(result.outputFolder)).toBe(true);
    expect(created(result.sessionId).cwd).toBe(project);
    const prompt = asked(result.sessionId);
    expect(prompt).toContain(`Read the files in ${project}`);
    expect(prompt).toContain("the budget");
    expect(prompt).toContain(result.outputFolder);
    expect(prompt).not.toMatch(/\{\w+\}/);
  });

  test("Given the same template, When it starts in Portuguese, Then the prompt is the Portuguese one", async () => {
    const { start, asked, project } = await setup();
    const ack = await start({
      templateId: "summarise-folder",
      language: "pt-BR",
      values: { folder: project },
    });
    const result = ack.data as TemplateStartResult;
    expect(asked(result.sessionId)).toContain(`Leia os arquivos de ${project}`);
    // An optional field left out reads as none, not as a hole.
    expect(asked(result.sessionId)).toContain("(nenhum)");
  });

  test("Given each preset, When a task starts, Then the mode is plan, default or acceptEdits, and plan-first always starts in plan", async () => {
    const { start, created, project } = await setup([
      custom(),
      custom({ id: "edit-first", planFirst: true }),
      custom({ id: "ask-notes", preset: "ask_before_changes" }),
    ]);
    const mode = async (templateId: string) => {
      const ack = await start({ templateId, language: "en", values: { folder: project } });
      return created((ack.data as TemplateStartResult).sessionId).permissionMode;
    };
    expect(await mode("summarise-folder")).toBe("plan");
    expect(await mode("ask-notes")).toBe("default");
    expect(await mode("edit-notes")).toBe("acceptEdits");
    expect(await mode("edit-first")).toBe("plan");
    // Whatever the template, a task never starts without its questions.
    for (const id of ["draft-report", "review-document", "compare-files"]) {
      const file = join(project, "a.txt");
      writeFileSync(file, "x");
      const values: Record<string, string> = {
        folder: project,
        topic: "t",
        file,
        depth: "quick",
        first: file,
        second: file,
      };
      const ack = await start({ templateId: id, language: "en", values });
      expect(["plan", "default", "acceptEdits"]).toContain(
        created((ack.data as TemplateStartResult).sessionId).permissionMode,
      );
    }
  });

  test("Given a template that asks for no folder, When a task starts, Then it is refused: there is nowhere to work", async () => {
    const { start } = await setup([
      custom({
        id: "no-folder",
        fields: [{ id: "topic", kind: "text", label: both("Topic") }],
        prompt: both("Write about {topic}."),
      }),
    ]);
    const ack = await start({
      templateId: "no-folder",
      language: "en",
      values: { topic: "tea" },
    });
    expect(ack.ok).toBe(false);
    expect(refusal(ack)).toMatchObject({ code: "bad_request", reason: "template_no_folder" });
  });

  test("Given a folder the host allows but that is not there, When a task starts, Then it is refused like a folder outside", async () => {
    const { start, root } = await setup();
    const ack = await start({
      templateId: "summarise-folder",
      language: "en",
      values: { folder: join(root, "missing") },
    });
    expect(ack.ok).toBe(false);
    expect(refusal(ack)).toMatchObject({
      code: "forbidden_cwd",
      reason: "template_folder_outside",
    });
  });

  test("Given a folder the host does not allow, When a task starts, Then it is refused with the folder to ask for, and no session exists", async () => {
    const { start, outside, manager } = await setup();
    const ack = await start({
      templateId: "summarise-folder",
      language: "en",
      values: { folder: outside },
    });
    expect(ack.ok).toBe(false);
    expect(refusal(ack)).toMatchObject({
      code: "forbidden_cwd",
      reason: "template_folder_outside",
      params: { folder: outside },
    });
    expect(manager.list()).toEqual([]);
  });

  test("Given a file field, When the file is in an allowed folder, Then the task works in the file's folder; a file outside is refused", async () => {
    const { start, created, project, outside } = await setup();
    const file = join(project, "notes", "a.txt");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "x");
    const ok = await start({
      templateId: "review-document",
      language: "en",
      values: { file, depth: "careful" },
    });
    const result = ok.data as TemplateStartResult;
    expect(result.workingFolder).toBe(dirname(file));
    expect(created(result.sessionId).cwd).toBe(dirname(file));
    const away = await start({
      templateId: "review-document",
      language: "en",
      values: { file: join(outside, "b.txt"), depth: "quick" },
    });
    expect(refusal(away).reason).toBe("template_folder_outside");
  });

  test("Given a choice, When the answer is an option, Then the prompt carries the option's words; any other answer is refused", async () => {
    const { start, asked, project } = await setup();
    const file = join(project, "a.txt");
    writeFileSync(file, "x");
    const ok = await start({
      templateId: "review-document",
      language: "en",
      values: { file, depth: "careful" },
    });
    expect(asked((ok.data as TemplateStartResult).sessionId)).toContain("Level of detail: Careful");
    const wrong = await start({
      templateId: "review-document",
      language: "en",
      values: { file, depth: "reckless" },
    });
    expect(refusal(wrong)).toMatchObject({
      reason: "template_choice_invalid",
      params: { field: "depth" },
    });
  });

  test("Given a missing required field or an unknown template, When a task starts, Then it is refused with what to fix", async () => {
    const { start, project } = await setup();
    const missing = await start({
      templateId: "draft-report",
      language: "en",
      values: { folder: project },
    });
    expect(refusal(missing)).toMatchObject({
      code: "bad_request",
      reason: "template_field_missing",
      params: { field: "topic" },
    });
    const unknown = await start({ templateId: "nope", language: "en", values: {} });
    expect(refusal(unknown)).toMatchObject({ code: "not_found", reason: "template_unknown" });
  });

  test("Given a template with its own results folder, When it starts, Then that folder is used if it stays inside the chosen one, and refused if it escapes", async () => {
    const { start, project } = await setup([
      custom({ id: "own-out", outputFolder: "Reports/2026" }),
      custom({ id: "escape-out", outputFolder: "../elsewhere" }),
      custom({ id: "abs-out", outputFolder: "/tmp/x" }),
    ]);
    const own = await start({ templateId: "own-out", language: "en", values: { folder: project } });
    expect((own.data as TemplateStartResult).outputFolder).toBe(join(project, "Reports", "2026"));
    for (const id of ["escape-out", "abs-out"]) {
      const ack = await start({ templateId: id, language: "en", values: { folder: project } });
      expect(refusal(ack).reason).toBe("template_output_outside");
    }
  });
});
