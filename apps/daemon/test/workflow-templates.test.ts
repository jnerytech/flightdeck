import { describe, expect, test } from "bun:test";
import { LocalizedText, WorkflowTemplate } from "@flightdeck/protocol";
import { PACK_IDS } from "../src/personas/pack.ts";
import { parseFindings } from "../src/workflows/findings.ts";
import { checkCommands, parseWorkflow, type Step } from "../src/workflows/schema.ts";
import { workflowTemplates } from "../src/workflows/templates.ts";

const TEST_COMMAND = "bun run test";
const all = workflowTemplates(TEST_COMMAND);
const byId = (id: string) => all.find((template) => template.id === id);

/** The steps of a template's file, or none when the file does not parse. */
function stepsOf(yaml: string): Step[] {
  return parseWorkflow(yaml).workflow?.steps ?? [];
}

/** The persona of each agent step that opens a session (one that continues another has none). */
const agentPersonas = (steps: Step[]) =>
  steps.flatMap((step) => ("agent" in step ? [step.agent.persona] : []));

describe("workflow templates (issue #79)", () => {
  test("ships the tech-debt scan, the alert fixer and the post-mortem draft, in that order", () => {
    expect(all.map((template) => template.id)).toEqual([
      "tech-debt-scan",
      "alert-fixer",
      "post-mortem",
    ]);
  });

  test("each template has the protocol's shape, with both languages", () => {
    expect(all.length > 0).toBe(true);
    for (const template of all) {
      expect(WorkflowTemplate.safeParse(template).success).toBe(true);
      for (const text of [template.title, template.description, template.limits]) {
        expect(LocalizedText.safeParse(text).success).toBe(true);
      }
    }
  });

  test("each template is committed to .flightdeck/workflows/<id>.yaml", () => {
    expect(all.length > 0).toBe(true);
    for (const template of all) {
      expect(template.path).toBe(`.flightdeck/workflows/${template.id}.yaml`);
    }
  });

  test("each file passes the workflow validation with no issue", () => {
    expect(all.length > 0).toBe(true);
    for (const template of all) {
      expect(parseWorkflow(template.yaml).errors).toEqual([]);
    }
  });

  test("each file names the inputs the template lists, and its agents run in a pack persona", () => {
    expect(all.length > 0).toBe(true);
    for (const template of all) {
      const parsed = parseWorkflow(template.yaml).workflow;
      expect(parsed?.inputs).toEqual(template.inputs);
      const personas = agentPersonas(stepsOf(template.yaml));
      expect(personas.length > 0).toBe(true);
      expect(personas.every((persona) => persona === template.persona)).toBe(true);
      expect(PACK_IDS.includes(template.persona)).toBe(true);
    }
  });

  test("a push always waits for approval: a gate comes before every pr step", () => {
    const pushing = all.filter((template) => stepsOf(template.yaml).some((step) => "pr" in step));
    expect(pushing.map((template) => template.id)).toEqual(["alert-fixer", "post-mortem"]);
    for (const template of pushing) {
      const steps = stepsOf(template.yaml);
      const pr = steps.findIndex((step) => "pr" in step);
      expect(pr > 0 && "gate" in (steps[pr - 1] ?? {})).toBe(true);
    }
  });

  test("the tech-debt scan reads only, pushes nothing and raises its findings as cards", () => {
    const scan = byId("tech-debt-scan");
    expect(scan?.persona).toBe("arquiteto");
    expect(scan?.inputs).toEqual([]);
    expect(scan?.checkFilled).toBeNull();
    const steps = stepsOf(scan?.yaml ?? "");
    expect(steps.map((step) => step.id)).toEqual(["scan", "raise"]);
    const [first, second] = steps;
    expect(first && "agent" in first ? first.agent.permissionMode : "").toBe("plan");
    expect(second && "cards" in second ? second.cards.from : "").toBe("scan");
    expect(steps.some((step) => "pr" in step || "check" in step)).toBe(false);
  });

  test("each file sets a budget of turns and minutes, and fans no agents out", () => {
    expect(all.length > 0).toBe(true);
    for (const template of all) {
      const parsed = parseWorkflow(template.yaml).workflow;
      expect(typeof parsed?.budget.maxTurns).toBe("number");
      expect(typeof parsed?.budget.maxMinutes).toBe("number");
      expect(stepsOf(template.yaml).some((step) => "parallel" in step)).toBe(false);
    }
  });

  test("the scan's limits do not promise more than plan mode gives", () => {
    const scan = byId("tech-debt-scan");
    expect(scan?.limits.en.includes("plan mode")).toBe(true);
    expect(scan?.limits["pt-BR"].includes("modo de plano")).toBe(true);
    expect(scan?.limits.en.toLowerCase().includes("read-only")).toBe(false);
    expect(scan?.limits["pt-BR"].toLowerCase().includes("só leitura")).toBe(false);
  });

  test("the example block in the scan's prompt is itself a valid list of findings", () => {
    const first = stepsOf(byId("tech-debt-scan")?.yaml ?? "")[0];
    const prompt = first && "agent" in first ? first.agent.prompt : "";
    const read = parseFindings(prompt);
    expect(read.ok && read.findings.length).toBe(1);
  });

  test("the alert fixer takes the alert, tries at most 3 times, then asks before it pushes", () => {
    const fixer = byId("alert-fixer");
    expect(fixer?.inputs).toEqual(["alert"]);
    expect(fixer?.persona).toBe("dev");
    const loop = stepsOf(fixer?.yaml ?? "").find((step) => "loop" in step);
    expect(loop && "loop" in loop ? loop.loop.max : 0).toBe(3);
  });

  test("the post-mortem draft takes the incident and runs as the sre persona", () => {
    const draft = byId("post-mortem");
    expect(draft?.inputs).toEqual(["incident"]);
    expect(draft?.persona).toBe("sre");
  });

  test("the project's test command fills the alert fixer's check line", () => {
    const fixer = byId("alert-fixer");
    const commands = checkCommands(parseWorkflow(fixer?.yaml ?? "").workflow ?? emptyWorkflow());
    expect(commands).toEqual([TEST_COMMAND]);
    expect(fixer?.checkFilled).toBe(true);
  });

  test("a template with no check line says so", () => {
    expect(byId("post-mortem")?.checkFilled).toBeNull();
  });

  test("with no known test command the check line is a placeholder that fails", () => {
    const fixer = workflowTemplates(null).find((template) => template.id === "alert-fixer");
    expect(fixer?.checkFilled).toBe(false);
    const commands = checkCommands(parseWorkflow(fixer?.yaml ?? "").workflow ?? emptyWorkflow());
    expect(commands.length).toBe(1);
    expect(commands[0]).toContain("your test command");
    expect(commands[0]).toEndWith("&& false");
  });

  test("a command that is not a plain form never reaches the file", () => {
    for (const command of ['bun test"; rm -rf /', "a\nb", "x'y", "", "a".repeat(200)]) {
      const fixer = workflowTemplates(command).find((template) => template.id === "alert-fixer");
      expect(fixer?.checkFilled).toBe(false);
      expect(fixer?.yaml.includes("rm -rf")).toBe(false);
    }
  });
});

function emptyWorkflow() {
  return { inputs: [], budget: {}, steps: [] };
}
