import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const UI = resolve(import.meta.dir, "../src/ui");

/**
 * The classes of the first stylesheet (removed in phase 10): a screen that still uses one is
 * unstyled. Screens move to Tailwind utilities and the shadcn components one family at a time.
 */
const LEGACY = new Set([
  "muted",
  "row",
  "primary",
  "badge",
  "badge-warn",
  "badge-muted",
  "card",
  "warning",
  "notice",
  "form",
  "check",
  "danger",
  "warn",
  "session",
  "session-header",
  "session-controls",
  "session-error",
  "msg",
  "msg-user",
  "msg-assistant",
  "welcome",
  "timeline",
  "composer",
  "always-allow",
  "streaming",
  "turn-result",
  "error",
  "markdown",
  "tool-call",
  "tool-name",
  "tool-summary",
  "tool-input",
  "tool-result",
  "external",
  "diff",
  "diff-file",
  "history",
  "projects",
  "workflows",
  "run",
  "rules",
  "gate",
  "usage",
  "maintenance",
  "hooks",
  "host-page",
  "host-info",
  "quota-charts",
  "quota-chart",
  "update-banner",
  "global-search",
  "palette-section",
  "palette-list",
  "search-status",
  "snippet",
  "filters",
  "form-error",
]);

/** The class tokens a source gives to `className`, in a string or in a `cn(...)`/ternary. */
function classTokens(source: string): string[] {
  const found: string[] = [];
  for (const attribute of source.matchAll(
    /className=(?:"([^"]*)"|\{([^}]*(?:\{[^}]*\}[^}]*)*)\})/g,
  )) {
    const literals = attribute[1] !== undefined ? [attribute[1]] : [];
    for (const literal of (attribute[2] ?? "").matchAll(/"([^"]*)"|`([^`]*)`/g)) {
      literals.push(literal[1] ?? literal[2] ?? "");
    }
    for (const text of literals) found.push(...text.split(/\s+/).filter(Boolean));
  }
  return found;
}

/** The screens already moved to the new base. */
const MIGRATED = [
  "SessionView.tsx",
  "ExternalView.tsx",
  "TranscriptReader.tsx",
  "ToolCall.tsx",
  "Markdown.tsx",
  "NewSessionForm.tsx",
  "AlwaysAllow.tsx",
  "TerminalButton.tsx",
];

describe("direcao-visual: telas", () => {
  test("as classes do estilo antigo saem das telas migradas (sessão, leitor, nova sessão)", () => {
    const violations = MIGRATED.flatMap((file) =>
      classTokens(readFileSync(resolve(UI, file), "utf8"))
        .filter((token) => LEGACY.has(token))
        .map((token) => `${file}: ${token}`),
    );
    expect(violations).toEqual([]);
  });

  test("o detector de classes antigas vê string, cn() e ternário", () => {
    expect(
      classTokens(
        `<div className="card flex" /><p className={cn("muted", x ? "row" : "gap-2")} />`,
      ),
    ).toEqual(["card", "flex", "muted", "row", "gap-2"]);
  });
});
