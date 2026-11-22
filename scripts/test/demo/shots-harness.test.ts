import { describe, expect, test } from "bun:test";
import { HarnessPreview, HarnessTemplateInfo } from "@flightdeck/protocol";
import type { DemoIds } from "../../demo-seed.ts";
import { harnessShots } from "../../lib/shots/table-harness.ts";

const IDS = { project: "web" } as DemoIds;
const NAMES = [
  "projeto-harness",
  "projeto-harness-preview",
  "projeto-harness-preview-recusa",
  "projeto-harness-compartilhar",
  "host-modelos-harness",
  "host-modelos-harness-vazio",
  "host-modelos-harness-apagar",
];
const named = (name: string) => harnessShots(IDS).find((shot) => shot.name === name);

/** What a print's `prepare` does, as the calls it makes on the page, in order. */
async function calls(name: string): Promise<string[]> {
  const made: string[] = [];
  const text = (arg: unknown): string => {
    if (arg instanceof RegExp || typeof arg === "string") return String(arg);
    if (typeof arg === "object" && arg !== null) return Object.values(arg).map(text).join(",");
    return typeof arg;
  };
  const member = (call: string): unknown =>
    new Proxy(
      (...args: unknown[]) => {
        made.push(`${call}(${args.map(text).join(",")})`);
        return recorder;
      },
      { get: (_target, prop) => (recorder as Record<string | symbol, unknown>)[prop] },
    );
  // `then` stays undefined, or awaiting the recorder would wait for it forever.
  const recorder: unknown = new Proxy(() => recorder, {
    get: (_target, prop) => (prop === "then" ? undefined : member(String(prop))),
  });
  await named(name)?.prepare?.(recorder as never);
  return made;
}

const wired = (name: string, command: string) =>
  named(name)?.wire?.find((rule) => rule.command === command);

// #4110: the trust panel's Claude Code setup, its setup and share dialogs and the host's templates
// had no print, so no axe check and no review of their states.
describe("the harness prints (#4110)", () => {
  test("the table prints the panel, the setup preview and its refusal, the share dialog and the templates with, without and being deleted", () => {
    expect(harnessShots(IDS).map((shot) => shot.name)).toEqual(NAMES);
  });

  test("the first four open the demo's project page, the last three the host page", () => {
    for (const name of NAMES.slice(0, 4)) {
      expect(named(name)?.route).toEqual({ name: "project", host: "demo-alfa", projectId: "web" });
    }
    for (const name of NAMES.slice(4)) {
      expect(named(name)?.route).toEqual({ name: "host", host: "demo-alfa" });
    }
  });

  test("the setup preview print answers the preview with files, hooks and deny rules the protocol accepts, and the templates the dialog starts from", () => {
    const preview = wired("projeto-harness-preview", "project.harness.preview");
    const parsed = HarnessPreview.safeParse(preview && "data" in preview ? preview.data : null);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.files.map((file) => file.path)).toContain("CLAUDE.md");
    expect(parsed.data.settings?.hooks.length).toBeGreaterThan(0);
    expect(parsed.data.settings?.denyRules.length).toBeGreaterThan(0);
    const templates = wired("projeto-harness-preview", "harness.templates.list");
    const list =
      templates && "data" in templates ? (templates.data as { templates: unknown[] }) : null;
    expect(list?.templates.length).toBeGreaterThan(0);
    expect(list?.templates.every((item) => HarnessTemplateInfo.safeParse(item).success)).toBe(true);
  });

  test("the refused-preview print refuses the preview with a reason, and the panel print and the share print leave the host's answers as they are", () => {
    const refused = wired("projeto-harness-preview-recusa", "project.harness.preview");
    expect(refused && "refuse" in refused ? refused.refuse : "").toContain("git");
    expect(named("projeto-harness")?.wire).toBeUndefined();
    expect(named("projeto-harness-compartilhar")?.wire).toBeUndefined();
  });

  test("the templates prints answer the list: two templates, none, and two with the delete asked", () => {
    for (const [name, size] of [
      ["host-modelos-harness", 2],
      ["host-modelos-harness-vazio", 0],
      ["host-modelos-harness-apagar", 2],
    ] as const) {
      const rule = wired(name, "harness.templates.list");
      const data = rule && "data" in rule ? (rule.data as { templates: unknown[] }) : null;
      expect(data?.templates).toHaveLength(size);
      expect(data?.templates.every((item) => HarnessTemplateInfo.safeParse(item).success)).toBe(
        true,
      );
    }
  });

  test("no print deletes, applies, commits or shares: the host never sees a write", () => {
    const writes = [
      "harness.templates.delete",
      "project.harness.apply",
      "project.harness.commit",
      "project.harness.export",
    ];
    for (const shot of harnessShots(IDS)) {
      for (const rule of shot.wire ?? []) expect(writes).not.toContain(rule.command);
    }
  });

  test("the setup print scrolls to the panel, then opens the setup dialog", async () => {
    const made = await calls("projeto-harness-preview");
    const panel = made.findIndex((call) => call.includes("Configuração do Claude Code"));
    const open = made.findIndex((call) => call.includes("Configurar o Claude Code"));
    expect(panel).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(panel);
  });

  test("the share print opens the share dialog and names the template", async () => {
    const made = await calls("projeto-harness-compartilhar");
    const open = made.findIndex((call) => call.includes("Compartilhar como modelo"));
    const field = made.findIndex((call) => call.startsWith("fill("));
    expect(open).toBeGreaterThan(-1);
    expect(field).toBeGreaterThan(open);
  });

  test("the delete print opens Settings, scrolls to the templates, then asks to delete the first one", async () => {
    const made = await calls("host-modelos-harness-apagar");
    const settings = made.findIndex((call) => call.includes("Configurações"));
    const section = made.findIndex((call) =>
      call.includes("Modelos de configuração do Claude Code"),
    );
    const del = made.findIndex((call) => call.includes("Apagar o modelo"));
    expect(settings).toBeGreaterThan(-1);
    expect(section).toBeGreaterThan(settings);
    expect(del).toBeGreaterThan(section);
  });
});
