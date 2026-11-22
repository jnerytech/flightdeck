import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { Card, RunProcessState, RunState } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { waiter } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { RunPanel } = await import("../../src/features/runenv/run-panel.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

afterEach(cleanup);
const settle = waiter(3000);

const proc = (over: Partial<RunProcessState>): RunProcessState => ({
  name: "web",
  terminalId: "t1",
  status: "exited",
  exitCode: 0,
  url: null,
  ready: "none",
  ...over,
});
const run = (over: Partial<RunState>): RunState => ({
  cardId: "c1",
  status: "idle",
  setup: "pending",
  setupTerminalId: null,
  ports: {},
  processes: [],
  error: null,
  ...over,
});

/** The panel of a trusted run.yaml, on a store whose run is `state` and whose Run and Stop the test answers. */
async function panel(
  lang: "en" | "pt-BR",
  state: RunState,
  calls: string[] = [],
  info: Record<string, unknown> = {},
) {
  const store = new AppStore(memoryPlatform(false, lang).platform);
  await store.i18n.setLang(lang);
  store.runEnv.config = (async () => ({
    exists: true,
    hash: "h",
    trusted: true,
    errors: [],
    config: { exclusive: false, setup: null, run: [], ports: [] },
    ...info,
  })) as unknown as typeof store.runEnv.config;
  store.runEnv.updated("h", state);
  const answers: Array<() => Promise<void>> = [];
  const asked = (what: string) => {
    calls.push(what);
    return new Promise<void>((resolve) => answers.push(resolve as () => Promise<void>));
  };
  store.runEnv.start = (() => asked("start")) as unknown as typeof store.runEnv.start;
  store.runEnv.stop = (() => asked("stop")) as unknown as typeof store.runEnv.stop;
  render(
    <TContext.Provider value={store.i18n.t}>
      <RunPanel store={store} hostId="h" card={{ id: "c1", projectId: "p" } as Card} />
    </TContext.Provider>,
  );
  await settle(
    () =>
      screen.queryByText(store.i18n.t(`runEnv.status.${state.status}`)) !== null ||
      screen.queryByRole("button", { name: store.i18n.t("runEnv.trust") }) !== null,
  );
  return { store, answers };
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

describe("the run panel tells what happened to each process and what was pressed (#3707)", () => {
  test("a process with no exit code never shows the word null, in either language", async () => {
    await panel("en", run({ status: "ended", processes: [proc({ exitCode: null })] }));
    expect(screen.queryByText(/null/)).toBeNull();
    expect(screen.queryByText("ended without an exit code")).not.toBeNull();
    cleanup();
    await panel("pt-BR", run({ status: "ended", processes: [proc({ exitCode: null })] }));
    expect(screen.queryByText(/null/)).toBeNull();
    expect(screen.queryByText("encerrado sem código de saída")).not.toBeNull();
  });

  test("a process that ended with a code but 0, or with none, reads as an error; code 0 stays muted", async () => {
    const processes = [
      proc({ name: "api", terminalId: "t1", exitCode: 1 }),
      proc({ name: "web", terminalId: "t2", exitCode: 0 }),
      proc({ name: "job", terminalId: "t3", exitCode: null }),
    ];
    await panel("en", run({ status: "ended", processes }));
    const classOf = (text: string) => screen.queryByText(text)?.className ?? "";
    expect({
      crashed: classOf("ended (code 1)").includes("text-status-error"),
      clean: classOf("ended (code 0)").includes("text-status-error"),
      signalled: classOf("ended without an exit code").includes("text-status-error"),
    }).toEqual({ crashed: true, clean: false, signalled: true });
  });

  test("Run is busy until the host answers, so a second click sends nothing", async () => {
    const calls: string[] = [];
    const { answers } = await panel("en", run({}), calls);
    await click("Run");
    expect(screen.queryByRole("button", { name: "Run" })?.getAttribute("aria-busy")).toBe("true");
    await click("Run");
    expect(calls).toEqual(["start"]);
    await act(async () => answers[0]?.());
    expect(screen.queryByRole("button", { name: "Run" })?.getAttribute("aria-busy")).not.toBe(
      "true",
    );
  });

  test("Stop is busy until the host answers, so a second click sends nothing", async () => {
    const calls: string[] = [];
    const { answers } = await panel("en", run({ status: "running" }), calls);
    await click("Stop");
    expect(screen.queryByRole("button", { name: "Stop" })?.getAttribute("aria-busy")).toBe("true");
    await click("Stop");
    expect(calls).toEqual(["stop"]);
    await act(async () => answers[0]?.());
    expect(screen.queryByRole("button", { name: "Stop" })?.getAttribute("aria-busy")).not.toBe(
      "true",
    );
  });

  test("a refused Run is an alert, and the status is a live region that follows the run", async () => {
    const { store } = await panel("en", run({ error: "the port is taken" }));
    expect(screen.queryByRole("alert")?.textContent).toBe("the port is taken");
    expect(screen.queryByRole("status")?.textContent).toBe("Not running");
    await act(async () => store.runEnv.updated("h", run({ status: "running" })));
    expect(screen.queryByRole("status")?.textContent).toBe("Running");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("the run status is an output element, so it reads as a status without a role attribute", async () => {
    await panel("en", run({ status: "running" }));
    const line = screen.queryByRole("status");
    expect({
      tag: line?.tagName,
      role: line?.getAttribute("role"),
      text: line?.textContent,
    }).toEqual({
      tag: "OUTPUT",
      role: null,
      text: "Running",
    });
  });

  test("when the host reports the run before it answers, the other button starts fresh, not busy", async () => {
    const { store } = await panel("en", run({}));
    await click("Run");
    await act(async () => store.runEnv.updated("h", run({ status: "running" })));
    expect(screen.queryByRole("button", { name: "Stop" })?.getAttribute("aria-busy")).not.toBe(
      "true",
    );
    expect(screen.queryByRole("button", { name: "Stop" })?.hasAttribute("disabled")).toBe(false);
  });

  test("a process the person stopped is not shown as a crash, but a crash after the next Run is", async () => {
    const { store, answers } = await panel(
      "en",
      run({ status: "running", processes: [proc({ status: "running", exitCode: null })] }),
    );
    await click("Stop");
    await act(async () => answers[0]?.());
    await act(async () =>
      store.runEnv.updated("h", run({ status: "ended", processes: [proc({ exitCode: 137 })] })),
    );
    const cls = () => screen.queryByText("ended (code 137)")?.className ?? "";
    expect(cls().includes("text-status-error")).toBe(false);
    await click("Run");
    await act(async () =>
      store.runEnv.updated("h", run({ status: "ended", processes: [proc({ exitCode: 137 })] })),
    );
    expect(cls().includes("text-status-error")).toBe(true);
  });
});

describe("the run panel keeps the focus where the person pressed, and its lists read (#4063, #4064)", () => {
  const focused = (name: string) =>
    document.activeElement === screen.queryByRole("button", { name });
  const press = async (name: string) => {
    (screen.queryByRole("button", { name }) as HTMLElement).focus();
    await click(name);
  };

  test("Run pressed with the focus on it hands the focus to Stop, and Stop hands it back to Run", async () => {
    const { store, answers } = await panel("en", run({ status: "ended" }));
    await press("Run");
    await act(async () => answers[0]?.());
    await act(async () => store.runEnv.updated("h", run({ status: "running" })));
    expect(focused("Stop")).toBe(true);
    await press("Stop");
    await act(async () => answers[1]?.());
    await act(async () => store.runEnv.updated("h", run({ status: "ended" })));
    expect(focused("Run")).toBe(true);
  });

  test("a run that ends by itself leaves the focus on the control the person is on", async () => {
    const { store } = await panel(
      "en",
      run({ status: "running", processes: [proc({ status: "running", exitCode: null })] }),
    );
    (screen.queryByRole("button", { name: "View log of web" }) as HTMLElement).focus();
    await act(async () =>
      store.runEnv.updated("h", run({ status: "ended", processes: [proc({ exitCode: 0 })] })),
    );
    expect(focused("View log of web")).toBe(true);
    expect(focused("Run")).toBe(false);
  });

  test("a press the host never turned into a run does not take the focus when the run changes much later", async () => {
    const { store, answers } = await panel("en", run({ status: "ended" }));
    await press("Run");
    await act(async () => answers[0]?.());
    const later = spyOn(Date, "now").mockReturnValue(Date.now() + 11_000);
    try {
      await act(async () => store.runEnv.updated("h", run({ status: "running" })));
    } finally {
      later.mockRestore();
    }
    expect(focused("Stop")).toBe(false);
  });

  test("a trusted panel with no process yet has no empty list", async () => {
    await panel("en", run({ status: "idle" }));
    expect(screen.queryByRole("list", { name: "Processes" }) === null).toBe(true);
  });

  test("the process list is named, in both languages", async () => {
    const live = run({
      status: "running",
      processes: [proc({ status: "running", exitCode: null })],
    });
    await panel("en", live);
    expect(screen.queryByRole("list", { name: "Processes" }) !== null).toBe(true);
    cleanup();
    await panel("pt-BR", live);
    expect(screen.queryByRole("list", { name: "Processos" }) !== null).toBe(true);
  });

  test("a command with a long token wraps inside the trust list", async () => {
    const token = `/${"deep/".repeat(40)}`;
    await panel("en", run({}), [], {
      trusted: false,
      config: {
        exclusive: false,
        setup: null,
        run: [{ name: "web", cmd: ["bun", "run", token], env: {}, ports: [] }],
        ports: [],
      },
    });
    const code = screen.queryByText(`bun run ${token}`);
    expect(code?.className.includes("[overflow-wrap:anywhere]")).toBe(true);
  });
});
