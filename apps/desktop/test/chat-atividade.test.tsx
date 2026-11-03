import { afterEach, describe, expect, test } from "bun:test";
import type { SessionState } from "../src/lib/session-state.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { cleanup, render, within, act } = await import("@testing-library/react");
const screen = liveScreen(within);
const { SessionView } = await import("../src/ui/SessionView.tsx");
const { emptySession } = await import("../src/lib/session-state.ts");
const { activityOf } = await import("../src/lib/session-activity.ts");

afterEach(cleanup);

const withTool = (name: string, done = false): SessionState => ({
  ...emptySession(),
  status: "running" as const,
  items: [
    { kind: "user" as const, seq: 1, text: "faça" },
    {
      kind: "assistant" as const,
      seq: 2,
      blocks: [{ type: "tool_use" as const, id: "t1", name, input: {} }],
    },
  ],
  toolResults: done ? { t1: { content: "ok", isError: false } } : {},
});

describe("chat-atividade: what the session is doing", () => {
  test("a tool without a result is what runs, grouped by what it does", () => {
    expect(activityOf(withTool("Bash"))).toEqual({ kind: "tool", group: "command", tool: "Bash" });
    expect(activityOf(withTool("Edit")).kind).toBe("tool");
    expect((activityOf(withTool("MultiEdit")) as { group: string }).group).toBe("edit");
    expect((activityOf(withTool("Read")) as { group: string }).group).toBe("read");
    expect((activityOf(withTool("Grep")) as { group: string }).group).toBe("search");
    expect((activityOf(withTool("WebFetch")) as { group: string }).group).toBe("web");
    expect((activityOf(withTool("Task")) as { group: string }).group).toBe("agent");
    expect(activityOf(withTool("mcp__x__y"))).toEqual({
      kind: "tool",
      group: "other",
      tool: "mcp__x__y",
    });
  });

  test("without a tool running: waiting for approval, writing, or thinking", () => {
    expect(activityOf(withTool("Bash", true))).toEqual({ kind: "thinking" });
    expect(activityOf({ ...withTool("Bash", true), streaming: "olá" })).toEqual({
      kind: "writing",
    });
    expect(activityOf({ ...withTool("Bash"), status: "awaiting_permission" })).toEqual({
      kind: "waiting",
    });
  });
});

const view = (session: SessionState) =>
  render(
    <SessionView
      title="s"
      session={session}
      actions={{
        send: async () => {},
        interrupt: async () => {},
        close: async () => {},
        resume: async () => {},
        respond: async () => {},
      }}
    />,
  );

describe("chat-atividade: the line above the message box", () => {
  test("while a turn runs it names the activity and the time, and the live region names it too", () => {
    view(withTool("Bash"));
    const line = screen.getByTestId("activity");
    expect(line.textContent).toContain("Executando um comando");
    expect(line.textContent).toContain("0 s");
    expect(screen.getByRole("status", { name: "Trabalhando…" }).textContent).toBe(
      "Executando um comando",
    );
  });

  test("the time keeps counting", async () => {
    view(withTool("Bash"));
    await act(async () => {
      await Bun.sleep(1300);
    });
    expect(screen.getByTestId("activity").textContent).toMatch(/[12] s/);
  });

  test("other activities, in the dictionary's words", () => {
    view({ ...withTool("Bash", true), streaming: "texto" });
    expect(screen.getByTestId("activity").textContent).toContain("Escrevendo");
    cleanup();
    view({ ...withTool("Bash"), status: "awaiting_permission" });
    expect(screen.getByTestId("activity").textContent).toContain("Esperando você");
    cleanup();
    view(withTool("mcp__x__y"));
    expect(screen.getByTestId("activity").textContent).toContain("Usando mcp__x__y");
  });

  test("an idle session has no activity line, and the spinner is not drawn", () => {
    view({ ...withTool("Bash", true), status: "idle" });
    expect(screen.queryByTestId("activity")).toBeNull();
  });

  test("the animation stops for people who ask for less motion", () => {
    view(withTool("Bash"));
    const icon = screen.getByTestId("activity").querySelector("svg");
    expect(icon?.getAttribute("class") ?? "").toContain("motion-safe:animate-spin");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });
});
