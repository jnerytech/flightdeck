import { describe, expect, test } from "bun:test";
import { hostsRoute, statusBarSummary } from "../src/lib/status-bar.ts";

type Host = {
  id: string;
  status: "online" | "offline" | "connecting";
  hostInfo?: { keepAwake?: { enabled: boolean; held: boolean } };
};
const host = (
  id: string,
  status: Host["status"],
  keepAwake?: { enabled: boolean; held: boolean },
) => ({ id, status, ...(keepAwake ? { hostInfo: { keepAwake } } : {}) }) as Host;

const state = (
  hosts: Host[],
  appUpdate: Partial<{
    offer: { version: string } | null;
    error: string | null;
    ready: string | null;
  }> = {},
  autoUpdate = false,
) =>
  ({
    hosts,
    appUpdate: { offer: null, upToDate: false, error: null, ready: null, ...appUpdate },
    settings: { autoUpdate },
  }) as never;

describe("status-bar: what the bar says about the app (issue #491)", () => {
  test("hosts count the online ones out of all of them, and terminals are the tabs given", () => {
    const s = statusBarSummary(
      state([
        host("a", "online"),
        host("b", "offline"),
        host("c", "connecting"),
        host("d", "online"),
      ]),
      3,
    );
    expect(s).toMatchObject({ hostsOnline: 2, hostsTotal: 4, terminals: 3 });
  });

  test("keep-awake is one state across the online hosts that offer it: holding, then on, then off, and none when no host offers it", () => {
    const off = { enabled: false, held: false };
    const on = { enabled: true, held: false };
    const held = { enabled: true, held: true };
    expect(statusBarSummary(state([host("a", "online")]), 0)).toMatchObject({
      keepAwake: null,
      keepAwakeHostId: null,
    });
    expect(statusBarSummary(state([host("a", "online", off)]), 0)).toMatchObject({
      keepAwake: "off",
      keepAwakeHostId: "a",
    });
    expect(
      statusBarSummary(state([host("a", "online", off), host("b", "online", on)]), 0),
    ).toMatchObject({ keepAwake: "on", keepAwakeHostId: "b" });
    expect(
      statusBarSummary(
        state([host("a", "online", on), host("b", "online", held), host("c", "online", held)]),
        0,
      ),
    ).toMatchObject({ keepAwake: "holding", keepAwakeHostId: "b" });
    // A host that is not online says nothing, whatever it said last.
    expect(statusBarSummary(state([host("a", "offline", held)]), 0).keepAwake).toBeNull();
  });

  test("the app update is ready, on offer or failed, in that order, and none otherwise", () => {
    const none = state([]);
    expect(statusBarSummary(none, 0)).toMatchObject({ update: null, updateVersion: null });
    expect(statusBarSummary(state([], { offer: { version: "0.38.0" } }), 0)).toMatchObject({
      update: "available",
      updateVersion: "0.38.0",
    });
    expect(
      statusBarSummary(state([], { offer: { version: "0.38.0" }, ready: "0.38.0" }, true), 0),
    ).toMatchObject({ update: "ready", updateVersion: "0.38.0" });
    expect(statusBarSummary(state([], { ready: "0.38.0" }), 0)).toMatchObject({
      update: "ready",
      updateVersion: "0.38.0",
    });
    expect(statusBarSummary(state([], { error: "offline" }), 0)).toMatchObject({
      update: "failed",
      updateVersion: null,
    });
    expect(
      statusBarSummary(state([], { offer: { version: "0.38.0" }, error: "x" }), 0),
    ).toMatchObject({ update: "available" });
  });

  test("the hosts item opens the first host that is not online, else the host in view, else the first, else the form", () => {
    const hosts = [host("a", "online"), host("b", "offline"), host("c", "connecting")];
    expect(hostsRoute(hosts, "a")).toEqual({ name: "host", host: "b" });
    expect(hostsRoute([host("a", "online"), host("d", "online")], "d")).toEqual({
      name: "host",
      host: "d",
    });
    expect(hostsRoute([host("a", "online"), host("d", "online")], null)).toEqual({
      name: "host",
      host: "a",
    });
    expect(hostsRoute([host("a", "online")], "gone")).toEqual({ name: "host", host: "a" });
    expect(hostsRoute([], null)).toEqual({ name: "add-host" });
  });
});
