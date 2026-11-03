import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Template, TemplateListResult } from "@flightdeck/protocol";
import { runDoctor } from "../src/doctor.ts";
import { startDaemon } from "../src/main.ts";
import { startServer } from "../src/server.ts";
import { BUILTIN_TEMPLATES } from "../src/templates/builtin.ts";
import { loadTemplates, parseTemplateFile, serializeTemplate } from "../src/templates/files.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "t".repeat(32);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const both = (en: string, ptBr = `${en} (pt)`) => ({ en, "pt-BR": ptBr });

const monthly = (): Template => ({
  id: "monthly-sales",
  title: both("Monthly sales report"),
  description: both("Builds the monthly sales report from the spreadsheets."),
  icon: "chart",
  fields: [
    { id: "folder", kind: "folder", label: both("Folder with the sheets") },
    {
      id: "month",
      kind: "choice",
      label: both("Month"),
      choices: [
        { id: "this", label: both("This month") },
        { id: "last", label: both("Last month") },
      ],
    },
  ],
  prompt: both("Build the sales report of {month} from {folder}."),
  preset: "ask_before_changes",
  planFirst: true,
});

/** Given a host folder with these files in it. */
function hostFolder(files: Record<string, string> = {}) {
  const dir = join(tempDir(), "templates");
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

describe("templates-host-files: a template as a Markdown file", () => {
  test("Given a template, When it is written and read back, Then it is the same template", () => {
    const template = monthly();
    expect(parseTemplateFile(serializeTemplate(template), "monthly-sales")).toEqual(template);
  });

  test("Given a file whose name is not its id, When read, Then it is refused", () => {
    expect(() => parseTemplateFile(serializeTemplate(monthly()), "other-name")).toThrow(
      /monthly-sales/,
    );
  });
});

describe("templates-host-files: listing the host's folder with the built-ins", () => {
  test("Given a host template, When listed, Then the built-ins come first and the host's after them", async () => {
    const dir = hostFolder({ "monthly-sales.md": serializeTemplate(monthly()) });
    const { templates, problems } = await loadTemplates({ dir, builtins: BUILTIN_TEMPLATES });
    expect(templates.map((t) => t.id)).toEqual([
      ...BUILTIN_TEMPLATES.map((t) => t.id),
      "monthly-sales",
    ]);
    expect(problems).toEqual([]);
  });

  test("Given no templates folder, When listed, Then only the built-ins show and nothing is wrong", async () => {
    const dir = join(tempDir(), "nothing-here");
    const { templates, problems } = await loadTemplates({ dir, builtins: BUILTIN_TEMPLATES });
    expect(templates).toEqual(BUILTIN_TEMPLATES);
    expect(problems).toEqual([]);
  });

  test("Given a broken file next to a good one, When listed, Then the good one shows and the broken one is a problem", async () => {
    const dir = hostFolder({
      "monthly-sales.md": serializeTemplate(monthly()),
      "broken.md": "---\nid: [unclosed\n---\nhello",
      "no-frontmatter.md": "just text",
      "wrong-preset.md": serializeTemplate({ ...monthly(), id: "wrong-preset" }).replace(
        "ask_before_changes",
        "bypassPermissions",
      ),
      "notes.txt": "not a template",
    });
    const { templates, problems } = await loadTemplates({ dir, builtins: BUILTIN_TEMPLATES });
    expect(templates.map((t) => t.id)).toContain("monthly-sales");
    expect(templates.map((t) => t.id)).not.toContain("wrong-preset");
    expect(problems.map((p) => p.file).sort()).toEqual([
      "broken.md",
      "no-frontmatter.md",
      "wrong-preset.md",
    ]);
    expect(problems.every((p) => p.reason.length > 0)).toBe(true);
  });

  test("Given a file that takes a built-in's id, When listed, Then the built-in stays and the file is a problem", async () => {
    const dir = hostFolder({
      "summarise-folder.md": serializeTemplate({ ...monthly(), id: "summarise-folder" }),
    });
    const { templates, problems } = await loadTemplates({ dir, builtins: BUILTIN_TEMPLATES });
    expect(templates.filter((t) => t.id === "summarise-folder")).toHaveLength(1);
    expect(templates.find((t) => t.id === "summarise-folder")).toEqual(BUILTIN_TEMPLATES[0]);
    expect(problems).toEqual([
      { file: "summarise-folder.md", reason: expect.stringContaining("built-in") },
    ]);
  });
});

describe("templates-host-files: the doctor and the protocol", () => {
  test("Given a template file that did not load, When the doctor runs, Then it warns and names the file", async () => {
    const deps = {
      config: () => ({ bind: "127.0.0.1", port: 7777, allowedRoots: ["/code"] }),
      isDirectory: () => true,
      serviceInstalled: async () => true,
      healthy: async () => true,
      tailscaleIp: async () => null,
      hooks: () => "installed" as const,
      claudePath: () => "/usr/bin/claude",
    };
    const clean = await runDoctor({ ...deps, templateProblems: async () => [] });
    expect(clean.checks.find((c) => c.name === "templates")).toBeUndefined();
    const broken = await runDoctor({
      ...deps,
      templateProblems: async () => [{ file: "broken.md", reason: "frontmatter" }],
    });
    const check = broken.checks.find((c) => c.name === "templates");
    expect(check?.status).toBe("warn");
    expect(check?.detail).toContain("broken.md");
    expect(check?.fix).toBeTruthy();
  });

  test("Given a host with templates, When template.list is asked, Then it answers with them and the feature is announced", async () => {
    const dir = hostFolder({
      "monthly-sales.md": serializeTemplate(monthly()),
      "broken.md": "nope",
    });
    const { manager } = newManager();
    const server = startServer({
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [tempDir()],
      manager,
      templates: () => loadTemplates({ dir, builtins: BUILTIN_TEMPLATES }),
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const list = await client.data<TemplateListResult>("template.list", {});
    expect(list?.templates.map((t) => t.id)).toContain("monthly-sales");
    expect(list?.problems.map((p) => p.file)).toEqual(["broken.md"]);
    const info = await client.data<{ features: string[] }>("host.info", {});
    expect(info?.features).toContain("templates");
  });
});

describe("templates-host-files: the in-app doctor", () => {
  test("Given a running daemon with a broken template file, When doctor.run is asked, Then the templates check warns and names the file", async () => {
    const dir = tempDir();
    const file = join(dir, "config.json");
    const dataDir = join(dir, "data");
    mkdirSync(join(dataDir, "templates"), { recursive: true });
    writeFileSync(join(dataDir, "templates", "broken.md"), "not a template");
    writeFileSync(file, JSON.stringify({ port: 0, token: TOKEN, dataDir }));
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
    );
    cleanups.push(() => daemon.stop());
    const client = new FrameClient(daemon.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const report = await client.data<{
      checks: Array<{ id: string; status: string; detail: string }>;
    }>("doctor.run", {});
    const check = report?.checks.find((c) => c.id === "templates");
    expect(check?.status).toBe("warn");
    expect(check?.detail).toContain("broken.md");
  });
});
