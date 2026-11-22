import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { uiIdle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TracePanel } = await import("../../src/features/trace/ui.ts");
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");

import type { AppStore } from "../../src/lib/app-store.ts";

afterEach(cleanup);

const TRACE = {
  claudeSessionId: "c1",
  costUsd: null,
  durationMs: null,
  costliest: null,
  slowest: null,
  turns: [
    {
      id: "turn:1",
      kind: "turn",
      name: "turn",
      n: 1,
      label: "Fix the build",
      input: null,
      result: null,
      startMs: 0,
      durationMs: null,
      costUsd: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      error: false,
      children: [],
    },
  ],
};

/** A store whose host answers the trace, then the export with `redacted` fields hidden. */
function fakeStore(redacted: number, saves: boolean) {
  const saved: string[] = [];
  const store = {
    hostCommand: async (_host: string, type: string) =>
      type === "trace.get" ? TRACE : { filename: "trace-c1.json", json: "{}", redacted },
    system: {
      saveFile: async (name: string) => {
        if (saves) saved.push(name);
        return saves;
      },
    },
  };
  return { store: store as unknown as AppStore, saved };
}

const show = async (store: AppStore, language: "en" | "pt-BR") => {
  render(
    <TContext.Provider value={translator(language)}>
      <TracePanel store={store} hostId="h" claudeSessionId="c1" />
    </TContext.Provider>,
  );
  await uiIdle();
};

const press = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    if (button) fireEvent.click(button);
  });
  await uiIdle();
};

const status = () => screen.queryByRole("status")?.textContent ?? null;

describe("rastro-export-status: what Export trace says it did", () => {
  test("a saved export with nothing hidden says the file was saved", async () => {
    const { store, saved } = fakeStore(0, true);
    await show(store, "en");
    expect(screen.queryByRole("status")).toBeNull();
    await press("Export trace");
    expect(saved).toEqual(["trace-c1.json"]);
    expect(status()).toBe("Trace saved.");
  });

  test("a saved export with hidden fields says how many held secrets", async () => {
    const { store } = fakeStore(3, true);
    await show(store, "en");
    await press("Export trace");
    expect(status()).toBe("Trace saved. 3 fields hidden because they held secrets.");
  });

  test("a dismissed save dialog says nothing was saved, never that it was", async () => {
    const { store } = fakeStore(3, false);
    await show(store, "en");
    await press("Export trace");
    expect(status()).toBe("Nothing was saved.");
  });

  test("the line goes away when the include content choice changes", async () => {
    const { store } = fakeStore(0, true);
    await show(store, "en");
    await press("Export trace");
    expect(status()).toBe("Trace saved.");
    await act(async () => {
      fireEvent.click(screen.queryByLabelText("Include content") as HTMLElement);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("the same lines read in Portuguese", async () => {
    const saves = fakeStore(2, true);
    await show(saves.store, "pt-BR");
    await press("Exportar rastro");
    expect(status()).toBe("Rastro salvo. 2 campos ocultados por conterem segredos.");
    cleanup();
    const dismissed = fakeStore(0, false);
    await show(dismissed.store, "pt-BR");
    await press("Exportar rastro");
    expect(status()).toBe("Nada foi salvo.");
  });
});
