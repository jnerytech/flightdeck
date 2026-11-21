import { describe, expect, test } from "bun:test";
import type { RunConfigInfo, RunState } from "@flightdeck/protocol";
import { configLines, stateLines, streamLine } from "../../src/runenv/domain/runenv-cli-view.ts";

const info = (over: Partial<RunConfigInfo> = {}): RunConfigInfo => ({
  exists: true,
  hash: "abc",
  trusted: true,
  errors: [],
  config: null,
  ...over,
});

const state = (over: Partial<RunState> = {}): RunState => ({
  cardId: "card-1",
  status: "running",
  setup: "done",
  setupTerminalId: null,
  ports: {},
  processes: [],
  error: null,
  ...over,
});

describe("runenv-cli-view: what `flightdeckd runenv` prints", () => {
  test("a project with no run.yaml says so, one with a file shows its hash and trust", () => {
    expect(configLines("app", info({ exists: false }))).toEqual(["app: no run.yaml"]);
    expect(configLines("app", info({ hash: null, trusted: false, errors: ["bad key"] }))).toEqual([
      "app: run.yaml, hash none, not trusted",
      "error: bad key",
    ]);
  });

  test("the setup, the ports and each process are listed by name, never with env values", () => {
    const config = {
      exclusive: true,
      setup: ["bun install"],
      ports: ["web", "api"],
      run: [
        {
          name: "web",
          cmd: ["bun", "dev"],
          ready: { http: "/health" },
          env: { SECRET: "do-not-print" },
        },
        { name: "api", cmd: ["bun", "api"], env: {} },
      ],
    } as unknown as NonNullable<RunConfigInfo["config"]>;
    const lines = configLines("app", info({ config }));
    expect(lines).toEqual([
      "app: run.yaml, hash abc, trusted",
      "exclusive: yes",
      "ports: web, api",
      "setup:",
      "  bun install",
      "processes:",
      "  web: bun dev, ready /health, env SECRET",
      "  api: bun api",
    ]);
    expect(lines.join("\n")).not.toContain("do-not-print");
  });

  test("a file with no ports, no setup and no processes prints none for each", () => {
    const config = { exclusive: false, ports: [], run: [] } as unknown as NonNullable<
      RunConfigInfo["config"]
    >;
    expect(configLines("app", info({ config }))).toEqual([
      "app: run.yaml, hash abc, trusted",
      "exclusive: no",
      "ports: none",
      "setup: none",
    ]);
  });

  test("a run shows its state, its ports, a line a process and the error", () => {
    const lines = stateLines(
      state({
        ports: { web: 5173, api: 8080 },
        error: "setup failed",
        processes: [
          {
            name: "web",
            terminalId: "t1",
            status: "running",
            exitCode: null,
            url: "http://localhost:5173",
            ready: "ready",
          },
          {
            name: "api",
            terminalId: "t2",
            status: "exited",
            exitCode: 2,
            url: null,
            ready: "timeout",
          },
          {
            name: "job",
            terminalId: "t3",
            status: "exited",
            exitCode: null,
            url: null,
            ready: "none",
          },
        ],
      }),
    );
    expect(lines).toEqual([
      "card-1: running, setup done",
      "ports: web 5173, api 8080",
      "  web (t1): running, ready, http://localhost:5173",
      "  api (t2): exited with code 2, timeout",
      "  job (t3): exited, no ready check",
      "error: setup failed",
    ]);
  });

  test("a run with no ports and no error prints only its state, and a stream update is one line", () => {
    expect(stateLines(state())).toEqual(["card-1: running, setup done"]);
    expect(
      streamLine(
        state({
          ports: { web: 1 },
          processes: [
            {
              name: "web",
              terminalId: "t1",
              status: "running",
              exitCode: null,
              url: null,
              ready: "waiting",
            },
          ],
        }),
      ),
    ).toBe("card-1: running, setup done; ports: web 1; web (t1): running, waiting");
  });
});
