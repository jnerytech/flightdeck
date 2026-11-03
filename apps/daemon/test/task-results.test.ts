import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TaskResultsResult, TemplateStartResult } from "@flightdeck/protocol";
import { startServer } from "../src/server.ts";
import { BUILTIN_TEMPLATES } from "../src/templates/builtin.ts";
import { TaskTracker } from "../src/templates/tasks.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "t".repeat(32);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const put = (file: string, text: string, secondsAgo = 0) => {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
  const at = new Date(Date.now() - secondsAgo * 1000);
  utimesSync(file, at, at);
};
const names = (result: TaskResultsResult) => result.files.map((f) => `${f.change}:${f.name}`);

/** Given a folder with two old files, a task that began looking at it. */
async function began(opts: { cap?: number; dir?: string } = {}) {
  const work = tempDir();
  put(join(work, "old.txt"), "old", 600);
  put(join(work, "stays.txt"), "same", 600);
  const tracker = new TaskTracker({
    dir: opts.dir ?? tempDir(),
    ...(opts.cap ? { cap: opts.cap } : {}),
  });
  const output = join(work, "Flightdeck results");
  mkdirSync(output, { recursive: true });
  const before = await tracker.prepare([work, output]);
  await tracker.keep("s1", [work, output], before);
  return { tracker, work, output };
}

describe("task-results: what a task made", () => {
  test("Given a task that wrote a report and changed a file, When results are asked, Then the new and the changed ones show, newest first, and the untouched one does not", async () => {
    const { tracker, work, output } = await began();
    put(join(work, "old.txt"), "old but longer now", 5);
    put(join(output, "report.md"), "# Report", 1);
    const result = await tracker.results("s1");
    expect(names(result)).toEqual(["new:report.md", "changed:old.txt"]);
    expect(result.files[0]).toMatchObject({
      path: join(output, "report.md"),
      sizeBytes: 8,
      change: "new",
    });
    expect(result.truncated).toBe(false);
  });

  test("Given nothing happened, When results are asked, Then the list is empty", async () => {
    const { tracker } = await began();
    expect(await tracker.results("s1")).toEqual({ files: [], truncated: false });
  });

  test("Given hidden files and folders, and a link out of the folder, When results are asked, Then none of them is listed", async () => {
    const { tracker, work } = await began();
    const away = tempDir();
    put(join(away, "secret.txt"), "not yours", 0);
    put(join(work, ".hidden.txt"), "h");
    put(join(work, ".git", "config"), "c");
    put(join(work, "visible.txt"), "v");
    symlinkSync(away, join(work, "link-out"));
    const result = await tracker.results("s1");
    expect(names(result)).toEqual(["new:visible.txt"]);
  });

  test("Given more new files than the cap, When results are asked, Then the cap shows, the newest first, and the list says it was cut", async () => {
    const { tracker, work } = await began({ cap: 3 });
    for (let i = 0; i < 6; i++) put(join(work, `f${i}.txt`), "x", 10 - i);
    const result = await tracker.results("s1");
    expect(result.files.map((f) => f.name)).toEqual(["f5.txt", "f4.txt", "f3.txt"]);
    expect(result.truncated).toBe(true);
  });

  test("Given a task begun before a restart, When a new tracker on the same folder is asked, Then it still knows what was there", async () => {
    const store = tempDir();
    const { work, output } = await began({ dir: store });
    put(join(output, "report.md"), "# Report", 0);
    const again = new TaskTracker({ dir: store });
    expect(names(await again.results("s1"))).toEqual(["new:report.md"]);
    expect(work).toBeTruthy();
  });

  test("Given a session that no task started, When results are asked, Then it is a plain not-found", async () => {
    const tracker = new TaskTracker({ dir: tempDir() });
    await expect(tracker.results("nope")).rejects.toMatchObject({
      code: "not_found",
      reason: "task_unknown",
    });
  });
});

describe("task-results: over the protocol, after a template starts", () => {
  test("Given a task started from a template, When a file lands in its results folder, Then task.results lists it as new", async () => {
    const { manager, root, project } = newManager();
    const tracker = new TaskTracker({ dir: tempDir() });
    const server = startServer({
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
      manager,
      templates: async () => ({ templates: BUILTIN_TEMPLATES, problems: [] }),
      tasks: tracker,
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    put(join(project, "old.txt"), "old", 600);
    const started = await client.data<TemplateStartResult>("template.start", {
      templateId: "summarise-folder",
      language: "en",
      values: { folder: project },
    });
    put(join(started?.outputFolder ?? "", "summary.md"), "# Summary", 0);
    const results = await client.data<TaskResultsResult>("task.results", {
      sessionId: started?.sessionId,
    });
    expect(names(results as TaskResultsResult)).toEqual(["new:summary.md"]);
    const info = await client.data<{ features: string[] }>("host.info", {});
    expect(info?.features).toContain("tasks");
  });
});
