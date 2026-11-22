import { afterEach, describe, expect, jest, test } from "bun:test";
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

const failed = (over: Partial<RunState>) =>
  run({ status: "failed", setup: "failed", ...over, ports: {} });

// #4062: a failed start or setup reads in the app's language, with the cause the host gave.
describe("the run panel says why a run failed in the app's language (#4062)", () => {
  test("a setup the host refused to open reads in each language, with the cause and no English sentence in pt-BR", async () => {
    const state = failed({
      error: "could not start the setup: the terminal is off on this host",
      errorKey: "run_setup_start_failed",
      errorParams: { cause: "the terminal is off on this host" },
    });
    await panel("pt-BR", state);
    expect(screen.queryByText(/could not start/)).toBeNull();
    expect(
      screen.queryByText("Não foi possível iniciar o setup: the terminal is off on this host"),
    ).not.toBeNull();
    cleanup();
    await panel("en", state);
    expect(
      screen.queryByText("Could not start the setup: the terminal is off on this host"),
    ).not.toBeNull();
  });

  test("a process the host refused to open is named in both languages", async () => {
    const state = failed({
      error: "could not start api: limit of 10 terminals per host",
      errorKey: "run_process_start_failed",
      errorParams: { name: "api", cause: "limit of 10 terminals per host" },
    });
    await panel("pt-BR", state);
    expect(
      screen.queryByText("Não foi possível iniciar api: limit of 10 terminals per host"),
    ).not.toBeNull();
    cleanup();
    await panel("en", state);
    expect(
      screen.queryByText("Could not start api: limit of 10 terminals per host"),
    ).not.toBeNull();
  });

  test("a setup that exited with a code reads in each language, with the code", async () => {
    const state = failed({
      error: "the setup failed (code 3)",
      errorKey: "run_setup_failed",
      errorParams: { code: 3 },
    });
    await panel("en", state);
    expect(screen.queryByText("The setup failed (code 3)")).not.toBeNull();
    cleanup();
    await panel("pt-BR", state);
    expect(screen.queryByText("O setup falhou (código 3)")).not.toBeNull();
  });

  test("a daemon that sends only the text, or a key the app does not know, shows the text as it came", async () => {
    await panel("pt-BR", failed({ error: "could not start api: sem terminal" }));
    expect(screen.queryByText("could not start api: sem terminal")).not.toBeNull();
    cleanup();
    await panel(
      "en",
      failed({ error: "a newer sentence", errorKey: "run_a_newer_reason", errorParams: {} }),
    );
    expect(screen.queryByText("a newer sentence")).not.toBeNull();
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
    await act(async () => {
      store.runEnv.updated("h", run({ status: "running" }));
      await answers[0]?.();
    });
    expect(focused("Stop")).toBe(true);
    await press("Stop");
    await act(async () => {
      store.runEnv.updated("h", run({ status: "ended" }));
      await answers[1]?.();
    });
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

  test("a press the host refused takes no focus when the run changes right after", async () => {
    const { store, answers } = await panel("en", run({ status: "ended" }));
    await press("Run");
    jest.useFakeTimers();
    try {
      await act(async () => answers[0]?.());
      await act(async () => {
        jest.advanceTimersByTime(1);
      });
    } finally {
      jest.useRealTimers();
    }
    await act(async () => store.runEnv.updated("h", run({ status: "running" })));
    expect(focused("Stop")).toBe(false);
  });

  test("a trusted panel with no process yet has no empty list", async () => {
    await panel("en", run({ status: "idle" }));
    expect(screen.queryByRole("list", { name: "Processes" }) === null).toBe(true); // NOSONAR: a boolean keeps a DOM node out of the failure diff
  });

  test("the process list is named, in both languages", async () => {
    const live = run({
      status: "running",
      processes: [proc({ status: "running", exitCode: null })],
    });
    await panel("en", live);
    expect(screen.queryByRole("list", { name: "Processes" })).not.toBeNull();
    cleanup();
    await panel("pt-BR", live);
    expect(screen.queryByRole("list", { name: "Processos" })).not.toBeNull();
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

describe("Trust keeps the panel when the host refuses and hands the focus to Run when it accepts (#4283)", () => {
  const untrusted = {
    trusted: false,
    config: {
      exclusive: false,
      setup: null,
      run: [{ name: "web", cmd: ["bun", "dev"], env: {}, ports: [] }],
      ports: [],
    },
  };
  const REFUSED = {
    en: /The host did not accept the trust/,
    "pt-BR": /O host não aceitou a confiança/,
  } as const;
  const confirmTrust = async (store: InstanceType<typeof AppStore>) => {
    await click(store.i18n.t("runEnv.trust"));
    await settle(
      () => screen.queryByRole("button", { name: store.i18n.t("runEnv.trustConfirm") }) !== null,
    );
    await click(store.i18n.t("runEnv.trustConfirm"));
  };
  const trustedInfo = { exists: true, hash: "h", errors: [], ...untrusted, trusted: true };
  // The host's answer and the panel's follow-up reads are promises: act drains them, no timer.
  const flush = () => act(async () => {});
  const onRun = () => (document.activeElement as HTMLElement | null)?.dataset.action === "run";

  test.each(["en", "pt-BR"] as const)(
    "a refused Trust leaves the review and the Trust button and says so (%s)",
    async (lang) => {
      const { store } = await panel(lang, run({}), [], untrusted);
      store.runEnv.trust = (async () => null) as typeof store.runEnv.trust;
      await confirmTrust(store);
      await flush();
      expect({
        review: screen.queryByText("bun dev") !== null,
        trustButton: screen.queryByRole("button", { name: store.i18n.t("runEnv.trust") }) !== null,
        said: REFUSED[lang].test(screen.queryByRole("alert")?.textContent ?? ""),
      }).toEqual({ review: true, trustButton: true, said: true });
    },
  );

  test("the refusal is gone once a second Trust is accepted", async () => {
    const { store } = await panel("en", run({}), [], untrusted);
    let answers = 0;
    store.runEnv.trust = (async () =>
      answers++ === 0 ? null : trustedInfo) as unknown as typeof store.runEnv.trust;
    await confirmTrust(store);
    await flush();
    await confirmTrust(store);
    await flush();
    expect(REFUSED.en.test(document.body.textContent ?? "")).toBe(false);
  });

  test("an answer that is not trusted counts as a refusal: the line shows and the focus stays off Run", async () => {
    const { store } = await panel("en", run({}), [], untrusted);
    store.runEnv.trust = (async () => ({
      ...trustedInfo,
      trusted: false,
    })) as unknown as typeof store.runEnv.trust;
    await confirmTrust(store);
    await flush();
    expect(REFUSED.en.test(screen.queryByRole("alert")?.textContent ?? "")).toBe(true);
  });

  test("an accepted Trust puts the focus on Run, not on the page body", async () => {
    const { store } = await panel("en", run({}), [], untrusted);
    store.runEnv.trust = (async () => trustedInfo) as unknown as typeof store.runEnv.trust;
    await confirmTrust(store);
    await flush();
    expect(onRun()).toBe(true);
  });
});
