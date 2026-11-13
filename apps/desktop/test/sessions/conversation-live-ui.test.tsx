import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../../src/i18n/en.ts";
import { ptBR } from "../../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "../dom.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { SessionView } = await import("../../src/features/sessions/session-view.tsx");
const { WorkingRow } = await import("../../src/features/sessions/working-row.tsx");
const { emptySession } = await import("../../src/features/sessions/domain/session-state.ts");

afterEach(cleanup);

/**
 * Issue #2674: a screen reader hears the conversation as a log (new messages are announced), and
 * the Working row announces "Working" and the tool, never the seconds that tick under it.
 */
const actions = {
  send: async () => {},
  interrupt: async () => {},
  close: async () => {},
  resume: async () => {},
  respond: async () => {},
};
const NOW = Date.parse("2026-11-03T10:00:12.000Z");

/** The text a screen reader reads from a node: everything but what is hidden from it. */
function announced(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (!(node instanceof Element) || node.getAttribute("aria-hidden") === "true") return "";
  return [...node.childNodes].map(announced).join("");
}
const spoken = (text: string) => text.replace(/\s+/g, " ").trim();

const running = (busySince: number) => ({
  ...emptySession(),
  status: "running" as const,
  busySince,
  items: [
    {
      kind: "assistant" as const,
      seq: 1,
      blocks: [{ type: "tool_use" as const, id: "t1", name: "Bash", input: {} }],
    },
  ],
});

describe("conversation-live: what a screen reader hears of a session (#2674)", () => {
  test("the conversation is a log with a name", () => {
    render(<SessionView title="s" session={running(NOW)} actions={actions} nowMs={NOW} />);
    expect(screen.queryByRole("log", { name: "Conversa" })).not.toBeNull();
  });

  test("the Working row announces the word and the tool, not the seconds", () => {
    render(<SessionView title="s" session={running(NOW - 12_000)} actions={actions} nowMs={NOW} />);
    const row = screen.queryByRole("status", { name: "Trabalhando…" });
    expect(row).not.toBeNull();
    expect([
      spoken(announced(row as Node)),
      // The seconds are still drawn for the eyes.
      row?.textContent?.includes("12s"),
    ]).toEqual(["Trabalhando… · Bash", true]);
  });

  test("the announced text is the same a second later and changes when the tool does", () => {
    const first = render(<WorkingRow label="Working" since={0} tool="Bash" nowMs={12_000} />);
    const before = spoken(announced(screen.getByRole("status")));
    first.rerender(<WorkingRow label="Working" since={0} tool="Bash" nowMs={13_000} />);
    const later = spoken(announced(screen.getByRole("status")));
    first.rerender(<WorkingRow label="Working" since={0} tool="Edit" nowMs={13_000} />);
    const other = spoken(announced(screen.getByRole("status")));
    expect([before, later, other]).toEqual(["Working · Bash", "Working · Bash", "Working · Edit"]);
  });

  test("the conversation has a name in both languages", () => {
    expect([en.session.conversation, ptBR.session.conversation]).toEqual([
      "Conversation",
      "Conversa",
    ]);
  });
});
