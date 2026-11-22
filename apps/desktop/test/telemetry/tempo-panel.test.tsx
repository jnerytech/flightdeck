import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { TelemetryItem, TelemetryPrompt } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "../dom.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");
const { TempoPanel } = await import("../../src/features/telemetry/tempo-panel.tsx");

afterEach(cleanup);

const tool = (at: number, toolName: string): TelemetryItem => ({
  kind: "tool",
  at,
  toolName,
  durationMs: 40,
  costUsd: null,
  success: true,
  error: null,
  decision: null,
  source: null,
  waitMs: null,
});
const prompt = (items: TelemetryItem[]): TelemetryPrompt => ({
  promptId: "p1",
  startedAt: 1000,
  endedAt: 2000,
  costUsd: 0,
  waitMs: 0,
  items,
});

/** A host that answers `telemetry.session` from a queue; the last answer repeats. */
function host(answers: Array<{ prompts: TelemetryPrompt[] } | null>) {
  return {
    hostCommand: async () => (answers.length > 1 ? answers.shift() : answers[0]),
  } as never;
}

function show(store: never, lang: "en" | "pt-BR") {
  render(
    <TContext.Provider value={translator(lang)}>
      <TempoPanel store={store} hostId="h1" claudeSessionId="c1" />
    </TContext.Provider>,
  );
}

const LANGS = [
  {
    lang: "en",
    empty: "No timing data for this session.",
    failed: "Could not read the timing of this session.",
    retry: "Try again",
  },
  {
    lang: "pt-BR",
    empty: "Sem dados de tempo para esta sessão.",
    failed: "Não foi possível ler o tempo desta sessão.",
    retry: "Tentar de novo",
  },
] as const;

for (const w of LANGS) {
  describe(`TempoPanel (issue #4070), ${w.lang}`, () => {
    test("a refused call shows an error and Try again, never the empty text; a retry that answers with no prompts shows the empty text", async () => {
      show(host([null, { prompts: [] }]), w.lang);
      await settle(() => screen.queryByRole("alert") !== null);
      expect(screen.queryByRole("alert")?.textContent).toContain(w.failed);
      expect(screen.queryByText(w.empty, { exact: false })).toBeNull();
      const retry = screen.queryByRole("button", { name: w.retry });
      expect(retry).not.toBeNull();
      await act(async () => {
        fireEvent.click(retry as HTMLElement);
      });
      await settle(() => screen.queryByText(w.empty, { exact: false }) !== null);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    test("an answer with no prompts shows the empty text and no error", async () => {
      show(host([{ prompts: [] }]), w.lang);
      await settle(() => screen.queryByText(w.empty, { exact: false }) !== null);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    test("two calls of one tool in the same millisecond both show and share no React key", async () => {
      const errors = spyOn(console, "error").mockImplementation(() => {});
      try {
        show(host([{ prompts: [prompt([tool(5, "Read"), tool(5, "Read")])] }]), w.lang);
        await settle(() => screen.queryAllByText("Read", { exact: false }).length > 0);
        expect(screen.queryAllByText("Read", { exact: false }).length).toBe(2);
        const warned = errors.mock.calls.some((call) => String(call[0]).includes("same key"));
        expect(warned).toBe(false);
      } finally {
        errors.mockRestore();
      }
    });
  });
}
