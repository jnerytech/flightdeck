import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { cleanup, render } = await import("@testing-library/react");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");
const { AlwaysAllow } = await import("../src/ui/AlwaysAllow.tsx");
const { translateError } = await import("../src/i18n/errors.ts");

afterEach(cleanup);

function show(lang: "en" | "pt-BR", toolName: string, input: Record<string, unknown>): HTMLElement {
  const { container } = render(
    <TContext.Provider value={translator(lang)}>
      <AlwaysAllow toolName={toolName} input={input} suggestions={undefined} onAllow={() => {}} />
    </TContext.Provider>,
  );
  return container;
}

const buttons = (root: HTMLElement) =>
  [...root.querySelectorAll("button")].map((b) => b.textContent);

describe("sempre-permitir-pasta: the app says why a rule was refused and does not offer one that would be (issue #524)", () => {
  test("a Grep or Glob over a folder has no 'Always in this project'; a file request keeps it", () => {
    for (const lang of ["en", "pt-BR"] as const) {
      const project = translator(lang)("alwaysAllow.project");
      expect(buttons(show(lang, "Grep", { pattern: "x", path: "/work/proj/src" }))).not.toContain(
        project,
      );
      cleanup();
      expect(buttons(show(lang, "Glob", { pattern: "*.ts", path: "/work/proj" }))).not.toContain(
        project,
      );
      cleanup();
      expect(buttons(show(lang, "Read", { file_path: "/work/proj/a.ts" }))).toContain(project);
      cleanup();
      // With no folder named, the rule is the tool's name: still offered.
      expect(buttons(show(lang, "Grep", { pattern: "x" }))).toContain(project);
      cleanup();
    }
  });

  test("a refusal for naming a folder says so in both languages; the other refusal keeps its text", () => {
    for (const lang of ["en", "pt-BR"] as const) {
      const t = translator(lang);
      const folder = translateError("invalid_permission_update", "m", t, {
        reason: "perm_rule_too_broad",
        params: { tool: "Grep", level: "high", names: "folder" },
      });
      expect(folder.title).toBe(t("alwaysAllow.refusedFolder", { tool: "Grep" }));
      const broad = translateError("invalid_permission_update", "m", t, {
        reason: "perm_rule_too_broad",
        params: { tool: "Bash", level: "high" },
      });
      expect(broad.title).toBe(
        t("daemonRefusal.perm_rule_too_broad", { tool: "Bash", level: "high" }),
      );
      expect(folder.title).not.toBe(broad.title);
    }
  });
});
