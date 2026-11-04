import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { MessageActions } = await import("../src/components/session/message-actions.tsx");
const { translator } = await import("../src/i18n/index.ts");
const { SessionView } = await import("../src/ui/SessionView.tsx");
const { applyEnvelope, emptySession } = await import("../src/lib/session-state.ts");

afterEach(cleanup);

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const assistant = (seq: number, text: string, at?: string) => ({
  kind: "assistant" as const,
  seq,
  blocks: [
    { type: "text" as const, text },
    { type: "text" as const, text: "segundo bloco" },
  ],
  ...(at ? { at } : {}),
});

function setup(
  extra: {
    pin?: { pinned: boolean; toggle(): void };
    fork?: () => void;
    copyText?: (text: string) => Promise<boolean>;
  } = {},
) {
  const copied: string[] = [];
  const actions = {
    send: async () => {},
    interrupt: async () => {},
    close: async () => {},
    resume: async () => {},
    respond: async () => {},
    copyText:
      extra.copyText ??
      (async (text: string) => {
        copied.push(text);
        return true;
      }),
  };
  const session = {
    ...emptySession(),
    status: "idle" as const,
    items: [
      { kind: "user" as const, seq: 1, text: "pergunta" },
      assistant(2, "primeira resposta", ago(65_000)),
      { kind: "user" as const, seq: 3, text: "outra" },
      assistant(4, "última resposta", ago(10_000)),
    ],
  };
  render(
    <SessionView
      title="s"
      session={session}
      actions={actions}
      {...(extra.pin ? { pin: extra.pin } : {})}
      {...(extra.fork ? { fork: extra.fork } : {})}
    />,
  );
  return { copied };
}

describe("chat-acoes: the action row under each assistant message", () => {
  test("every assistant message has a row, user messages have none, and it names the age", () => {
    setup();
    const rows = screen.getAllByRole("group", { name: "Ações da mensagem" });
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText("há 1 min")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText("agora")).toBeTruthy();
  });

  test("Copiar copies the text of the message, every block, and says so", async () => {
    const { copied } = setup();
    const rows = screen.getAllByRole("group", { name: "Ações da mensagem" });
    await act(async () => {
      fireEvent.click(
        within(rows[0] as HTMLElement).getByRole("button", { name: "Copiar mensagem" }),
      );
    });
    expect(copied).toEqual(["primeira resposta\n\nsegundo bloco"]);
    expect(within(rows[0] as HTMLElement).getByRole("status").textContent).toBe("Copiado");
  });

  test("Bifurcar and Fixar only show when the screen can do them, and Bifurcar only on the latest message", async () => {
    setup();
    expect(screen.queryByRole("button", { name: "Bifurcar a partir daqui" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Fixar sessão" })).toBeNull();
    cleanup();
    const calls: string[] = [];
    setup({
      fork: () => void calls.push("fork"),
      pin: { pinned: true, toggle: () => void calls.push("pin") },
    });
    const forks = screen.getAllByRole("button", { name: "Bifurcar a partir daqui" });
    expect(forks).toHaveLength(1);
    const rows = screen.getAllByRole("group", { name: "Ações da mensagem" });
    expect(
      within(rows[1] as HTMLElement).getByRole("button", { name: "Bifurcar a partir daqui" }),
    ).toBe(forks[0] as HTMLElement);
    const pins = screen.getAllByRole("button", { name: "Fixar sessão" });
    expect(pins[0]?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      fireEvent.click(forks[0] as HTMLElement);
      fireEvent.click(pins[0] as HTMLElement);
    });
    expect(calls).toEqual(["fork", "pin"]);
  });

  test("the row is hidden until hover or focus, but stays in the keyboard's reach", () => {
    setup();
    const row = screen.getAllByRole("group", { name: "Ações da mensagem" })[0] as HTMLElement;
    expect(row.className).toContain("message-actions");
    expect(row.hidden).toBe(false);
  });

  test("an assistant event keeps the time it came with", () => {
    const state = applyEnvelope(emptySession(), {
      type: "event",
      sessionId: "s",
      seq: 1,
      ts: "2026-11-03T10:00:00.000Z",
      event: { type: "message.assistant", blocks: [{ type: "text", text: "oi" }] },
    } as never);
    expect(state.items[0]).toMatchObject({ kind: "assistant", at: "2026-11-03T10:00:00.000Z" });
  });

  test("the age under a message is worked out again on every tick of the clock", async () => {
    const ticks: Array<() => void> = [];
    const interval = spyOn(globalThis, "setInterval").mockImplementation(((fn: () => void) => {
      ticks.push(fn);
      return 1;
    }) as unknown as typeof setInterval);
    const start = Date.now();
    const at = new Date(start - 10_000).toISOString();
    render(
      <MessageActions
        text="x"
        at={at}
        t={translator("pt-BR")}
        copyText={undefined}
        fork={undefined}
        pin={undefined}
      />,
    );
    expect(screen.getByText("agora")).toBeTruthy();
    const now = spyOn(Date, "now").mockReturnValue(start + 120_000);
    try {
      await act(async () => {
        for (const tick of ticks) tick();
      });
      expect(screen.getByText("há 2 min")).toBeTruthy();
    } finally {
      now.mockRestore();
      interval.mockRestore();
    }
  });
});
