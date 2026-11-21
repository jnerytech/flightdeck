import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { TracePanel } = await import("../../src/features/trace/ui.ts");
const { TContext } = await import("../../src/i18n/context.tsx");

afterEach(cleanup);

const node = (over: Record<string, unknown>) => ({
  n: null,
  label: null,
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
  ...over,
});

/** One turn with three tools under it: four replay steps. */
const TRACE = {
  claudeSessionId: "c1",
  costUsd: 0.1,
  durationMs: 5000,
  costliest: null,
  slowest: null,
  turns: [
    node({
      id: "turn:1",
      kind: "turn",
      name: "turn",
      n: 1,
      label: "Fix the build",
      children: ["a", "b", "c"].map((name) =>
        node({ id: `tool:${name}`, kind: "tool", name, input: `${name}.ts`, durationMs: 100 }),
      ),
    }),
  ],
};

/** The panel on a store whose `trace.get` answers as the test says: the trace, or null for a refusal. */
async function panel(language: "en" | "pt-BR", answers: Array<unknown>) {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  await store.i18n.setLang(language);
  const asked: string[] = [];
  store.hostCommand = (async (_host: string, type: string) => {
    asked.push(type);
    return answers.length > 1 ? answers.shift() : answers[0];
  }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <TracePanel store={store} hostId="h1" claudeSessionId="c1" />
    </TContext.Provider>,
  );
  await act(async () => Bun.sleep(30));
  return { asked, store };
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};
const alertText = () =>
  screen
    .queryAllByRole("alert")
    .map((el) => el.textContent ?? "")
    .join(" ");
const step = () => screen.queryByRole("status")?.textContent ?? "";

describe("rastro-estados (#3706)", () => {
  test("a refused trace.get says so with Try again, then shows the trace, in both languages", async () => {
    const { store } = await panel("en", [null, TRACE]);
    expect(alertText().includes("Could not load the trace.")).toBe(true);
    expect(screen.queryByText(store.i18n.t("states.loading"))).toBeNull();
    await click("Try again");
    expect(screen.queryByRole("region", { name: "Session trace" })).not.toBeNull();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    cleanup();
    await panel("pt-BR", [null]);
    expect(alertText().includes("Não deu para carregar o rastro.")).toBe(true);
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).not.toBeNull();
  });

  test("the Replay button says whether the replay is open and what pressing it does", async () => {
    await panel("en", [TRACE]);
    expect(screen.queryByRole("button", { name: "Replay" })?.getAttribute("aria-expanded")).toBe(
      "false",
    );
    await click("Replay");
    expect(screen.queryByRole("region", { name: "Session replay" })).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Close replay" })?.getAttribute("aria-expanded"),
    ).toBe("true");
    await click("Close replay");
    expect(screen.queryByRole("region", { name: "Session replay" })).toBeNull();
  });

  test("Previous pauses the playback and the step stays where the person put it", async () => {
    await panel("en", [TRACE]);
    await click("Replay");
    await click("Play");
    await click("Next");
    await click("Previous");
    expect(screen.queryByRole("button", { name: "Play" })).not.toBeNull();
    const before = step();
    await act(async () => Bun.sleep(1300));
    expect(step()).toBe(before);
    expect(before).toBe("Step 1 of 4");
  });

  test("Next onto the last step ends the playback, and a playing replay is not read aloud", async () => {
    await panel("en", [TRACE]);
    await click("Replay");
    await click("Play");
    expect(screen.queryByRole("status")?.getAttribute("aria-live")).toBe("off");
    await click("Next");
    await click("Next");
    await click("Next");
    expect(step()).toBe("Step 4 of 4");
    expect(screen.queryByRole("button", { name: "Play" })).not.toBeNull();
    expect(screen.queryByRole("status")?.getAttribute("aria-live")).toBe("polite");
  });
});
