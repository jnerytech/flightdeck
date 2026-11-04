#!/usr/bin/env bun
/**
 * Simple-mode smoke (phase 33): a daemon server on the fake runtime, with the built-in templates
 * and a host template whose task writes a file. The host offers the templates; a task starts from
 * one in the host's folder; the question it asks comes with plain wording in both languages; the
 * person answers yes; the file lands; `task.results` lists it as new and `task.preview` reads it.
 * Nothing real is touched: the fake runtime, a temporary folder, no network.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  PlainInfo,
  TaskPreviewResult,
  TaskResultsResult,
  Template,
  TemplateListResult,
  TemplateStartResult,
} from "@flightdeck/protocol";
import { startServer } from "../apps/daemon/src/server.ts";
import { BUILTIN_TEMPLATES } from "../apps/daemon/src/templates/builtin.ts";
import { TaskTracker } from "../apps/daemon/src/templates/tasks.ts";
import { newManager } from "../apps/daemon/test/helpers.ts";
import { FrameClient } from "../apps/daemon/test/history-helpers.ts";
import { assertHomeGuard, installHomeGuard } from "./test/home-guard.ts";
import { realTempDir } from "./test/temp-dir.ts";

const home = installHomeGuard();
const TOKEN = "smoke-simple-token-0123456789abcdef";
const TIMEOUT_MS = 20_000;

let step = "prepare";
const log = (msg: string) => console.log(`  · ${msg}`);

async function until<T>(check: () => T | null | undefined | false, what: string): Promise<T> {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await Bun.sleep(20);
  }
}

const both = (en: string) => ({ en, "pt-BR": `${en} (pt)` });
/** The host's own template: its prompt makes the fake runtime ask to write a file. */
const NOTE: Template = {
  id: "write-note",
  title: both("Write a note"),
  description: both("Writes a note in a folder."),
  icon: "notebook",
  fields: [{ id: "folder", kind: "folder", label: both("Folder") }],
  prompt: both("[tool] Write a note in {folder}."),
  preset: "ask_before_changes",
  planFirst: false,
};

async function run() {
  const { manager, store, root, project } = newManager();
  const tasks = new TaskTracker({ dir: realTempDir("flightdeck-smoke-simple-tasks-") });
  const server = startServer({
    manager,
    hostName: "smoke",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [root],
    ui: { mode: "simple", locked: false },
    onUiSettings: async () => {},
    templates: async () => ({ templates: [...BUILTIN_TEMPLATES, NOTE], problems: [] }),
    tasks,
  });
  const client = new FrameClient(server.url);
  try {
    await client.request("hello", { token: TOKEN, client: "smoke-simple" });

    step = "the host says it is simple and offers its templates";
    const info = await client.data<{ features: string[]; ui?: { mode: string; locked: boolean } }>(
      "host.info",
      {},
    );
    for (const feature of ["ui.mode", "templates", "tasks"]) {
      if (!info?.features.includes(feature)) throw new Error(`missing feature ${feature}`);
    }
    if (info.ui?.mode !== "simple") throw new Error(`host mode is ${info.ui?.mode}`);
    const list = await client.data<TemplateListResult>("template.list", {});
    const ids = list?.templates.map((t) => t.id) ?? [];
    for (const id of ["summarise-folder", "write-note"]) {
      if (!ids.includes(id)) throw new Error(`template ${id} is not offered: ${ids.join(",")}`);
    }
    log(`templates offered: ${ids.length}`);

    step = "a task starts from a template in an allowed folder";
    const started = await client.data<TemplateStartResult>("template.start", {
      templateId: "write-note",
      language: "en",
      values: { folder: project },
    });
    if (!started) throw new Error("template.start was refused");
    const events = () =>
      (
        store.db
          .query("SELECT payload FROM events WHERE session_id = ? ORDER BY seq")
          .all(started.sessionId) as Array<{ payload: string }>
      ).map(
        (row) => JSON.parse(row.payload) as { type: string; requestId?: string; plain?: PlainInfo },
      );

    step = "the question comes in plain words, in both languages";
    const asked = await until(
      () => events().find((e) => e.type === "permission.requested"),
      "permission.requested",
    );
    const sentence = asked.plain?.sentence;
    if (!sentence?.en || !sentence["pt-BR"]) throw new Error("the question has no plain wording");
    log(`asked: ${sentence.en}`);

    step = "the person answers yes and the file lands";
    const answer = await client.request("permission.respond", {
      requestId: asked.requestId,
      decision: "allow",
    });
    if (answer.ok !== true) throw new Error("the answer was refused");
    await until(() => events().some((e) => e.type === "tool.result"), "the tool result");
    // The fake runtime only acts out the question; the file Claude would write is written here.
    mkdirSync(started.outputFolder, { recursive: true });
    writeFileSync(join(started.outputFolder, "note.md"), "# Note\nhello\n");
    const types = events().map((e) => e.type);
    const requested = types.indexOf("permission.requested");
    const resolved = types.indexOf("permission.resolved");
    if (resolved !== -1 && resolved < requested) {
      throw new Error("permission.resolved came before permission.requested");
    }

    step = "task.results lists the new file and task.preview reads it";
    const results = await until(async () => {
      const r = await client.data<TaskResultsResult>("task.results", {
        sessionId: started.sessionId,
      });
      return r?.files.some((f) => f.name === "note.md" && f.change === "new") ? r : null;
    }, "task.results");
    void results;
    const file = (results as unknown as TaskResultsResult).files.find((f) => f.name === "note.md");
    const preview = await client.data<TaskPreviewResult>("task.preview", {
      sessionId: started.sessionId,
      path: file?.path,
    });
    if (typeof preview?.text !== "string") throw new Error("no preview");
    log(`result: note.md (${file?.change}), preview ${preview.text.length} bytes`);
  } finally {
    client.close();
    void server.stop();
  }
}

const work = realTempDir("flightdeck-smoke-simple-");
let code = 1;
try {
  await run();
  assertHomeGuard(home);
  console.log("SMOKE SIMPLE OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE SIMPLE FAIL at step "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  void work;
}
process.exit(code);
