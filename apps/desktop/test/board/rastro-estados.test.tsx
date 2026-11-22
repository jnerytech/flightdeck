import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle, stays } from "../wait.ts";

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
  const asked: Array<{ type: string; options: unknown }> = [];
  store.hostCommand = (async (
    _host: string,
    type: string,
    _payload: unknown,
    options?: unknown,
  ) => {
    asked.push({ type, options });
    return answers.length > 1 ? answers.shift() : answers[0];
  }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <TracePanel store={store} hostId="h1" claudeSessionId="c1" />
    </TContext.Provider>,
  );
  await settle(
    () =>
      screen.queryByRole("alert") !== null ||
      screen.queryByRole("region", {
        name: language === "en" ? "Session trace" : "Rastro da sessão",
      }) !== null,
  );
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
    const { store, asked } = await panel("en", [null, TRACE]);
    // The tab has its own Try again, so the banner must not offer a second one for the same refusal.
    expect(asked[0]).toEqual({ type: "trace.get", options: { retry: false } });
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
    await click("Next");
    await click("Play");
    await click("Previous");
    expect(screen.queryByRole("button", { name: "Play" })).not.toBeNull();
    const before = step();
    expect(before).toBe("Step 1 of 4");
    // Longer than one tick at 1x: a playback still running would have moved on by now.
    await stays(() => step() === before, 1300);
  });

  test("Next pauses the playback too, and a playing replay is not read aloud", async () => {
    await panel("en", [TRACE]);
    await click("Replay");
    await click("Play");
    expect(screen.queryByRole("status")?.getAttribute("aria-live")).toBe("off");
    await click("Next");
    expect(step()).toBe("Step 2 of 4");
    expect(screen.queryByRole("button", { name: "Play" })).not.toBeNull();
    expect(screen.queryByRole("status")?.getAttribute("aria-live")).toBe("polite");
  });

  // #3935: the counter alone said "Step 2 of 4"; what the step is has to be said with it.
  for (const language of ["en", "pt-BR"] as const) {
    test(`${language}: stepping says the step aloud, and a playing replay says nothing`, async () => {
      await panel(language, [TRACE]);
      await click("Replay");
      const said = () =>
        Array.from(document.querySelectorAll("[aria-live=polite]"))
          .map((el) => el.textContent ?? "")
          .join(" | ");
      expect(said().includes("Fix the build")).toBe(true);
      await click(language === "en" ? "Next" : "Próximo");
      expect(said().includes("a.ts")).toBe(true);
      await click(language === "en" ? "Play" : "Tocar");
      expect(said()).toBe("");
    });
  }

  // A screen reader speaks only text that changes inside a region that was already polite, so the
  // region has to stay polite while it plays and merely hold no text.
  test("the spoken step lives in one polite region that is empty while playing and filled when the person steps out of it", async () => {
    await panel("en", [TRACE]);
    await click("Replay");
    await click("Play");
    const spoken = document.querySelector("[aria-live=polite][aria-atomic=true]");
    expect(spoken).not.toBeNull();
    expect(spoken?.textContent).toBe("");
    await click("Next");
    expect(document.querySelector("[aria-live=polite][aria-atomic=true]") === spoken).toBe(true); // NOSONAR: a boolean keeps a DOM node out of the failure diff
    expect(spoken?.textContent?.includes("Step 2") || spoken?.textContent?.includes("a.ts")).toBe(
      true,
    );
  });

  test("a playback that reaches the last step stops by itself", async () => {
    await panel("en", [TRACE]);
    await click("Replay");
    const speed = screen.queryByRole("combobox", { name: "Speed" });
    expect(speed).not.toBeNull();
    await act(async () => {
      fireEvent.change(speed as HTMLElement, { target: { value: "4" } });
    });
    await click("Play");
    await settle(() => step() === "Step 4 of 4");
    await settle(() => screen.queryByRole("button", { name: "Play" }) !== null);
    expect(screen.queryByRole("status")?.getAttribute("aria-live")).toBe("polite");
  });
});
