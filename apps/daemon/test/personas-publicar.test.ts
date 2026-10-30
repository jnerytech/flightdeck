import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentConfig } from "../src/agentcfg/files.ts";
import { agentPublisher } from "../src/personas/publish.ts";

const request = (projectPath: string, prompt = "Revise como segurança.") => ({
  projectPath,
  name: "persona-seguranca",
  description: "Revisa mudanças procurando falhas de segurança",
  prompt,
  tools: ["Read", "Grep"],
  model: "claude-opus-5-5",
});

describe("personas-subagente: published through the project's agent editor (phase 12)", () => {
  test("the persona becomes .claude/agents/persona-<id>.md, which the agent editor lists", () => {
    const project = mkdtempSync(join(tmpdir(), "fd-pub-"));
    const agents = new AgentConfig({ claudeDir: mkdtempSync(join(tmpdir(), "fd-claude-")) });
    const result = agentPublisher(agents).publish(request(project));
    expect(result.path).toBe(".claude/agents/persona-seguranca.md");
    const listed = agents.list(project, "agent").filter((item) => item.origin === "project");
    expect(listed).toMatchObject([
      {
        path: ".claude/agents/persona-seguranca.md",
        name: "persona-seguranca",
        description: "Revisa mudanças procurando falhas de segurança",
      },
    ]);
    const text = readFileSync(join(project, result.path), "utf8");
    expect(text).toContain("tools: Read, Grep");
    expect(text).toContain("model: claude-opus-5-5");
    expect(text.trimEnd().endsWith("Revise como segurança.")).toBe(true);
  });

  test("publishing again replaces the agent with the persona's current text", () => {
    const project = mkdtempSync(join(tmpdir(), "fd-pub-"));
    const agents = new AgentConfig({ claudeDir: mkdtempSync(join(tmpdir(), "fd-claude-")) });
    const publisher = agentPublisher(agents);
    publisher.publish(request(project));
    publisher.publish(request(project, "Texto novo."));
    expect(existsSync(join(project, ".claude/agents/persona-seguranca.md"))).toBe(true);
    const text = readFileSync(join(project, ".claude/agents/persona-seguranca.md"), "utf8");
    expect(text.trimEnd().endsWith("Texto novo.")).toBe(true);
  });
});
