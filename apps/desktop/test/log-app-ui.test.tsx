import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { LogSink } from "../src/platform/types.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { DiagnosticsPanel } = await import("../src/components/settings/diagnostics-panel.tsx");
const { HostLogs } = await import("../src/components/hosts/host-logs.tsx");
const { TContext } = await import("../src/i18n/context.tsx");
const { APP_VERSION } = await import("../src/lib/version.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

function setup(options: { logs?: boolean; language?: "en" | "pt-BR" } = {}) {
  const mem = memoryPlatform(false, options.language ?? "en");
  const events: string[] = [];
  const written: string[] = [];
  const copied: string[] = [];
  const sink: LogSink = {
    write: async (line) => void written.push(line),
    tail: async (n) => {
      events.push(`tail:${n}`);
      return ["2026 INFO from the file", "2026 ERROR token=0123456789abcdef0123456789abcdef"];
    },
    openFolder: async () => void events.push("open"),
  };
  if (options.logs !== false) mem.platform.logs = sink;
  mem.platform.copyText = async (text) => void copied.push(text);
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  return { store, events, written, copied, mem };
}

const view = (store: InstanceType<typeof AppStore>, node: React.ReactNode) => (
  <TContext.Provider value={store.i18n.t}>{node}</TContext.Provider>
);
const click = (el: Element) =>
  act(async () => {
    fireEvent.click(el);
  });

describe("log-app-ui: Settings > Diagnostics (issue #255)", () => {
  test("Open logs folder asks the shell to open it", async () => {
    const w = setup();
    render(view(w.store, <DiagnosticsPanel store={w.store} />));
    await click(screen.getByRole("button", { name: "Open logs folder" }));
    expect(w.events).toEqual(["open"]);
  });

  test("Copy diagnostics copies the version, the system, the hosts and the last 50 lines, redacted, and says so", async () => {
    const w = setup();
    (w.store as unknown as { update(p: object): void }).update({
      hosts: [
        {
          id: "h1",
          name: "pc",
          status: "online",
          hostInfo: { daemonVersion: "0.37.0", features: ["costs", "logs"] },
          sessions: [],
        },
      ],
    });
    render(view(w.store, <DiagnosticsPanel store={w.store} />));
    await click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await settle(() => w.copied.length === 1);
    const text = w.copied[0] ?? "";
    expect(text).toContain(`Flightdeck ${APP_VERSION}`);
    expect(text).toContain("pc: online, flightdeckd 0.37.0, features: costs, logs");
    expect(text).toContain("2026 INFO from the file");
    expect(text).not.toContain("0123456789abcdef0123456789abcdef");
    expect(w.events).toContain("tail:50");
    expect(w.store.getState().notices.at(-1)?.text).toContain("Diagnostics copied");
  });

  test("the lines the app kept in memory come along when the file gives none", async () => {
    const w = setup();
    w.mem.platform.logs = {
      write: async () => {},
      tail: async () => [],
      openFolder: async () => {},
    };
    w.store.appLog.log("error", "host", "pc went offline");
    render(view(w.store, <DiagnosticsPanel store={w.store} />));
    await click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await settle(() => w.copied.length === 1);
    expect(w.copied[0]).toContain("pc went offline");
  });

  test("a log file that cannot be read does not stop the copy: the app's own lines are used", async () => {
    const w = setup();
    w.mem.platform.logs = {
      write: async () => {},
      tail: async () => {
        throw new Error("unreadable");
      },
      openFolder: async () => {},
    };
    w.store.appLog.log("warn", "host", "pi: offline");
    render(view(w.store, <DiagnosticsPanel store={w.store} />));
    await click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await settle(() => w.copied.length === 1);
    expect(w.copied[0]).toContain("pi: offline");
  });

  test("a browser has no file system: the panel is not there", () => {
    const w = setup({ logs: false });
    const { container } = render(view(w.store, <DiagnosticsPanel store={w.store} />));
    expect(container.textContent).toBe("");
  });

  test("it reads in Portuguese", () => {
    const w = setup({ language: "pt-BR" });
    render(view(w.store, <DiagnosticsPanel store={w.store} />));
    expect(screen.getByRole("button", { name: "Abrir a pasta de logs" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copiar diagnóstico" })).toBeTruthy();
  });
});

describe("log-app-ui: the app's own events reach the log", () => {
  test("a host changing state, a refusal and an update check each leave a line", async () => {
    const w = setup();
    const internals = w.store as unknown as {
      update(p: object): void;
      onStatus(id: string, conn: object, status: string): void;
      fail(error: unknown): void;
    };
    internals.update({ hosts: [{ id: "h1", name: "pc", status: "online", sessions: [] }] });
    internals.onStatus("h1", { info: null, incompatibility: null, retry: null }, "offline");
    internals.fail(new Error("the host refused: token=0123456789abcdef0123456789abcdef"));
    w.mem.platform.updater.check = async () => null;
    await w.store.checkAppUpdate();
    w.mem.platform.updater.check = async () => {
      throw new Error("no network");
    };
    await w.store.checkAppUpdate();
    const lines = w.store.appLog.recent(20).map((l) => l.replace(/^\S+ /, ""));
    expect(lines).toContain("WARN host pc: offline");
    expect(lines.some((l) => l.startsWith("ERROR refusal the host refused: [redacted]"))).toBe(
      true,
    );
    expect(lines).toContain("INFO update up to date");
    expect(lines.some((l) => l.startsWith("ERROR update ") && l.includes("no network"))).toBe(true);
    expect(w.written).toHaveLength(lines.length);
    expect(w.written.join("\n")).not.toContain("0123456789abcdef0123456789abcdef");
  });
});

describe("log-app-ui: the host's own log lines", () => {
  const host = (features: string[], status = "online") =>
    ({
      id: "h1",
      name: "pc",
      status,
      hostInfo: { daemonVersion: "x", features },
      sessions: [],
    }) as never;

  test("Copy the host's last log lines asks logs.tail, copies the lines and says so", async () => {
    const w = setup();
    const asked: Array<[string, unknown]> = [];
    w.store.hostCommand = (async (_h: string, type: string, payload: unknown) => {
      asked.push([type, payload]);
      return { lines: ["a", "b"], path: "/home/x/.flightdeck/logs/flightdeckd.log" };
    }) as never;
    render(view(w.store, <HostLogs store={w.store} host={host(["logs"])} />));
    await click(screen.getByRole("button", { name: "Copy the host's last log lines" }));
    await settle(() => w.copied.length === 1);
    expect(asked).toEqual([["logs.tail", { lines: 100 }]]);
    expect(w.copied[0]).toBe("a\nb");
    expect(w.store.getState().notices.at(-1)?.text).toContain("2 log lines copied");
  });

  test("a host with no log lines says so instead of copying nothing", async () => {
    const w = setup();
    w.store.hostCommand = (async () => ({ lines: [], path: "/x" })) as never;
    render(view(w.store, <HostLogs store={w.store} host={host(["logs"])} />));
    await click(screen.getByRole("button", { name: "Copy the host's last log lines" }));
    await settle(() => w.store.getState().notices.length > 0);
    expect(w.copied).toEqual([]);
    expect(w.store.getState().notices.at(-1)?.text).toContain("no log lines yet");
  });

  test("a host without the feature, or offline, has no button", () => {
    const w = setup();
    const a = render(view(w.store, <HostLogs store={w.store} host={host([])} />));
    expect(a.container.textContent).toBe("");
    cleanup();
    const b = render(view(w.store, <HostLogs store={w.store} host={host(["logs"], "offline")} />));
    expect(b.container.textContent).toBe("");
  });
});

describe("log-segredos-app: the store feeds the log the host tokens and the vault values (issue #255)", () => {
  const HOST_TOKEN = "Zk3fakehosttoken0123456789abcdefghijklmnop";
  const VAULT_VALUE = "Vx9fakevaultvalue0123456789";
  const host = (features: string[]) =>
    ({
      id: "h1",
      name: "pc",
      status: "online",
      hostInfo: { daemonVersion: "x", features },
      sessions: [],
    }) as never;

  test("a host's token and a vault value never reach the memory or the file, even typed into a message", async () => {
    const { store, written } = setup();
    await store.addHost({ name: "alfa", url: "ws://127.0.0.1:1", token: HOST_TOKEN });
    await store.addSecret({ name: "deploy", type: "token", value: VAULT_VALUE });
    await Bun.sleep(30);
    store.appLog.log("error", "host", `refused ${HOST_TOKEN} and ${VAULT_VALUE}`);
    const everything = `${written.join("\n")}\n${store.appLog.recent(50).join("\n")}`;
    expect(everything).not.toContain(HOST_TOKEN);
    expect(everything).not.toContain(VAULT_VALUE);
    expect(everything).toContain("refused [redacted] and [redacted]");
  });

  test("the host's lines are redacted again before they reach the clipboard, a hostile host included", async () => {
    const w = setup();
    w.store.hostCommand = (async () => ({
      lines: [`2026 INFO leaked ${HOST_TOKEN} and {"password":"hunter2hunter2"} in /home/ana/x`],
      path: "/x",
    })) as never;
    await w.store.addHost({ name: "alfa", url: "ws://127.0.0.1:1", token: HOST_TOKEN });
    render(view(w.store, <HostLogs store={w.store} host={host(["logs"])} />));
    await click(screen.getByRole("button", { name: "Copy the host's last log lines" }));
    await settle(() => w.copied.length === 1);
    expect(w.copied[0]).not.toContain(HOST_TOKEN);
    expect(w.copied[0]).not.toContain("hunter2hunter2");
    expect(w.copied[0]).toContain("in ~/x");
  });

  test("Copy diagnostics redacts the whole text: a host named like a secret is not copied", async () => {
    const w = setup();
    await w.store.addHost({
      name: `box token=${HOST_TOKEN}`,
      url: "ws://127.0.0.1:1",
      token: HOST_TOKEN,
    });
    render(view(w.store, <DiagnosticsPanel store={w.store} />));
    await click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await settle(() => w.copied.length === 1);
    expect(w.copied[0]).not.toContain(HOST_TOKEN);
  });
});

describe("log-cobertura-app: the host's log path, the vault cache and the Settings section (issue #255)", () => {
  test("a host that tells where its log is says so under the button", async () => {
    const w = setup();
    const host = {
      id: "h1",
      name: "pc",
      status: "online",
      hostInfo: {
        daemonVersion: "x",
        features: ["logs"],
        logPath: "/srv/fd/.flightdeck/logs/flightdeckd.log",
      },
      sessions: [],
    } as never;
    render(view(w.store, <HostLogs store={w.store} host={host} />));
    expect(document.body.textContent).toContain(
      "The host keeps its own log in /srv/fd/.flightdeck/logs/flightdeckd.log.",
    );
  });

  test("a vault that cannot be read leaves the log running with what it had", async () => {
    const w = setup();
    const store = w.store as unknown as {
      vaultValuesForScan(): Promise<string[]>;
      addSecret(input: { name: string; type: string; value: string }): Promise<unknown>;
      scanValues(): string[];
    };
    await store.addSecret({ name: "a", type: "token", value: "Vx9fakevaultvalue0123456789" });
    await Bun.sleep(30);
    expect(store.scanValues()).toContain("Vx9fakevaultvalue0123456789");
    store.vaultValuesForScan = async () => {
      throw new Error("keychain locked");
    };
    await store.addSecret({ name: "b", type: "token", value: "another-value-123456" });
    await Bun.sleep(30);
    expect(store.scanValues()).toContain("Vx9fakevaultvalue0123456789");
  });
});
