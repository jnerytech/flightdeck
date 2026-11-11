import { describe, expect, test } from "bun:test";
import type { HostInfoResult, TerminalInfo } from "@flightdeck/protocol";
import {
  type ClosingTerminal,
  type TerminalListener,
  TerminalsSlice,
} from "../../src/features/terminal/index.ts";

const info = (over: Partial<HostInfoResult>) => over as HostInfoResult;

/** A terminal as a host lists it. */
const terminal = (terminalId: string): TerminalInfo => ({
  terminalId,
  cwd: "/work",
  command: "bash",
  startedAt: "2026-11-11T00:00:00.000Z",
  attached: 1,
  cols: 80,
  rows: 24,
  exitCode: null,
  launchId: null,
});

/**
 * Terminals over stand-ins: the commands a host got, the tabs shown, what the banner was told, and
 * the tab whose close waits.
 */
function terminals(
  over: {
    hosts?: Array<{
      id: string;
      url?: string;
      status?: string;
      roots?: string[];
      hostInfo?: HostInfoResult | null;
    }>;
    refuseOpen?: boolean;
    spawnFails?: boolean;
    closing?: ClosingTerminal | null;
    tabGone?: boolean;
  } = {},
) {
  const sent: Array<{ type: string; payload: unknown }> = [];
  const opened: unknown[] = [];
  const closed: Array<{ hostId: string; terminalId: string; kill: boolean }> = [];
  const shown: string[] = [];
  const copied: string[] = [];
  const spawned: Array<{ program: string; args: string[] }> = [];
  const failures: unknown[] = [];
  let closing: ClosingTerminal | null = over.closing ?? null;
  let tabClosed = false;
  const hosts = (over.hosts ?? [{ id: "h", roots: ["/work"] }]).map((h) => ({
    id: h.id,
    url: h.url ?? "ws://10.0.0.2:7600",
    status: h.status ?? "online",
    info: h.roots ? { allowedRoots: h.roots } : null,
    hostInfo: h.hostInfo ?? null,
  }));
  const slice = new TerminalsSlice({
    hosts: () => hosts,
    terminalEnv: () => ({ windows: true, wt: true }),
    dispatch: async (_hostId, type, payload) => {
      sent.push({ type, payload });
      return (
        type === "terminal.list" ? { terminals: [terminal("t-1")] } : { terminalId: "t-9" }
      ) as never;
    },
    open: async (_hostId, payload) => {
      opened.push(payload);
      return over.refuseOpen ? null : terminal("t-1");
    },
    close: async (hostId, terminalId, kill) => void closed.push({ hostId, terminalId, kill }),
    showTab: (hostId, terminalId) => void shown.push(`${hostId}/${terminalId}`),
    closing: () => closing,
    setClosing: (next) => {
      closing = next;
    },
    closingTab: () =>
      over.tabGone
        ? null
        : {
            hostId: "h",
            terminalId: "t-1",
            closeTab: () => {
              tabClosed = true;
            },
          },
    copyText: async (text) => {
      copied.push(text);
      return true;
    },
    spawn: async (program, args) => {
      if (over.spawnFails) throw new Error("no wt");
      spawned.push({ program, args });
    },
    spawnFailed: (error) => void failures.push(String(error)),
  });
  return {
    slice,
    sent,
    opened,
    closed,
    shown,
    copied,
    spawned,
    failures,
    closingNow: () => closing,
    tabClosed: () => tabClosed,
  };
}

/** A listener that writes down what it heard. */
function listener() {
  const heard: string[] = [];
  const handlers: TerminalListener = {
    data: (base64) => void heard.push(`data:${base64}`),
    exited: (code) => void heard.push(`exited:${code}`),
    resync: () => void heard.push("resync"),
    offline: () => void heard.push("offline"),
  };
  return { heard, handlers };
}

describe("terminals (#1596)", () => {
  test("a host's terminal commands go out with their flow control and unwrap the list", async () => {
    const { slice, sent } = terminals();
    const host = slice.host("h");
    await host.attach("t-1");
    await host.write("t-1", "ls\r");
    const list = await host.list();
    expect({ list, sent }).toEqual({
      list: [terminal("t-1")],
      sent: [
        { type: "terminal.attach", payload: { terminalId: "t-1", flow: true } },
        { type: "terminal.write", payload: { terminalId: "t-1", data: "ls\r" } },
        { type: "terminal.list", payload: {} },
      ],
    });
  });

  test("a terminal opens in the first allowed folder and shows as a tab", async () => {
    const { slice, opened, shown } = terminals();
    const id = await slice.open("h");
    expect({ id, opened, shown }).toEqual({
      id: "t-1",
      opened: [{ cwd: "/work", cols: 80, rows: 24 }],
      shown: ["h/t-1"],
    });
  });

  test("a host with no folder, or a refused open, shows no tab", async () => {
    const none = terminals({ hosts: [{ id: "h" }] });
    const refused = terminals({ refuseOpen: true });
    expect({
      noFolder: await none.slice.open("h"),
      noFolderAsked: none.opened.length,
      refused: await refused.slice.open("h"),
      refusedShown: refused.shown,
    }).toEqual({ noFolder: null, noFolderAsked: 0, refused: null, refusedShown: [] });
  });

  test("Claude here resumes the session and names the persona when given", async () => {
    const { slice, opened, shown } = terminals();
    await slice.openClaude("h", { cwd: "/work/api", claudeSessionId: "c-1" }, "reviewer");
    await slice.openClaude("h", { cwd: "/work/api", claudeSessionId: null });
    expect({ opened, shown }).toEqual({
      opened: [
        { cwd: "/work/api", cols: 80, rows: 24, claude: { resume: "c-1", persona: "reviewer" } },
        { cwd: "/work/api", cols: 80, rows: 24, claude: {} },
      ],
      shown: ["h/t-1", "h/t-1"],
    });
  });

  test("a host opens terminals in the app only while online and announcing them", () => {
    const { slice } = terminals({
      hosts: [
        { id: "on", hostInfo: info({ features: ["terminal"] }) },
        { id: "old", hostInfo: info({ features: ["board"] }) },
        { id: "down", status: "offline", hostInfo: info({ features: ["terminal"] }) },
      ],
    });
    expect(["on", "old", "down", "ghost"].map((id) => slice.embedded(id))).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  test("output, the exit and a gap reach only the ones following that terminal until they stop", () => {
    const { slice } = terminals();
    const mine = listener();
    const other = listener();
    const stop = slice.follow("h", "t-1", mine.handlers);
    slice.follow("h", "t-2", other.handlers);
    slice.deliver("h", { type: "terminal.data", terminalId: "t-1", data: "aGk=" });
    slice.deliver("h", { type: "terminal.resync", terminalId: "t-1" });
    slice.deliver("h", { type: "terminal.exited", terminalId: "t-1", exitCode: 3 });
    stop();
    slice.deliver("h", { type: "terminal.data", terminalId: "t-1", data: "bGF0ZQ==" });
    expect({ mine: mine.heard, other: other.heard }).toEqual({
      mine: ["data:aGk=", "resync", "exited:3"],
      other: [],
    });
  });

  test("a host going offline tells only its own terminals", () => {
    const { slice } = terminals();
    const a = listener();
    const b = listener();
    slice.follow("h", "t-1", a.handlers);
    slice.follow("other", "t-1", b.handlers);
    slice.tellOffline("h");
    expect({ a: a.heard, b: b.heard }).toEqual({ a: ["offline"], b: [] });
  });

  test("the launch of the person's own terminal is a program here and a command to copy elsewhere", async () => {
    const local = terminals({
      hosts: [
        {
          id: "h",
          url: "ws://127.0.0.1:7600",
          hostInfo: info({ os: "win32", flightdeckdPath: "C:\\fd\\flightdeckd.exe" }),
        },
      ],
    });
    const remote = terminals({
      hosts: [
        { id: "h", hostInfo: info({ os: "linux", flightdeckdPath: "/usr/bin/flightdeckd" }) },
      ],
    });
    const target = { cwd: "/work", claudeSessionId: null };
    await local.slice.openIn("h", target);
    await remote.slice.openIn("h", target);
    expect({
      spawned: local.spawned,
      localCopied: local.copied,
      remoteSpawned: remote.spawned,
      remoteCopied: remote.copied,
      unknown: local.slice.launch("ghost", target),
    }).toEqual({
      spawned: [{ program: "wt.exe", args: ["-d", "/work", "C:\\fd\\flightdeckd.exe", "claude"] }],
      localCopied: [],
      remoteSpawned: [],
      remoteCopied: ["cd /work && /usr/bin/flightdeckd claude"],
      unknown: null,
    });
  });

  test("a terminal program that does not start goes to the banner", async () => {
    const t = terminals({
      spawnFails: true,
      hosts: [{ id: "h", url: "ws://localhost:7600", hostInfo: info({ os: "win32" }) }],
    });
    await t.slice.openIn("h", { cwd: "C:\\work", claudeSessionId: null });
    expect(t.failures).toEqual(["Error: no wt"]);
  });

  test("the close of a terminal tab ends the process, detaches, or keeps it by the answer", async () => {
    const pending = { areaId: "a", tabId: "tab-1" };
    const kill = terminals({ closing: pending });
    const detach = terminals({ closing: pending });
    const keep = terminals({ closing: pending });
    await kill.slice.finishClose(true);
    await detach.slice.finishClose(false);
    await keep.slice.finishClose(null);
    expect({
      kill: [kill.closed, kill.tabClosed(), kill.closingNow()],
      detach: [detach.closed, detach.tabClosed(), detach.closingNow()],
      keep: [keep.closed, keep.tabClosed(), keep.closingNow()],
    }).toEqual({
      kill: [[{ hostId: "h", terminalId: "t-1", kill: true }], true, null],
      detach: [[{ hostId: "h", terminalId: "t-1", kill: false }], true, null],
      keep: [[], false, null],
    });
  });

  test("a close with no waiting tab, or a tab already gone, does nothing", async () => {
    const idle = terminals();
    const gone = terminals({ closing: { areaId: "a", tabId: "tab-1" }, tabGone: true });
    await idle.slice.finishClose(true);
    await gone.slice.finishClose(true);
    expect({ idle: idle.closed, gone: gone.closed, goneClosing: gone.closingNow() }).toEqual({
      idle: [],
      gone: [],
      goneClosing: null,
    });
  });
});
