import { describe, expect, test } from "bun:test";
import { ALL_HOSTS } from "../../src/features/costs/domain/costs.ts";
import {
  awayHost,
  hostScope,
  routeScopeOf,
  topModel,
} from "../../src/features/costs/domain/costs-scope.ts";
import { ALL_SCOPE, type DataScope } from "../../src/features/costs/domain/data-scope.ts";

const host = (id: string, status = "online") => ({ id, status });
const scoped = (hostId: string): DataScope => ({ kind: "host", hostId });

describe("costs-scope: which hosts the screen reads", () => {
  test("a scoped host that reports costs is the only one read", () => {
    expect(hostScope(scoped("b"), [host("a"), host("b")])).toEqual({
      acrossHosts: false,
      hostId: "b",
      hostIds: ["b"],
    });
  });

  test("a scoped host that reports nothing reads nothing, not another host's numbers", () => {
    expect(hostScope(scoped("gone"), [host("a"), host("b")])).toEqual({
      acrossHosts: false,
      hostId: "",
      hostIds: [],
    });
  });

  test("with no scope, several hosts are read together", () => {
    expect(hostScope(ALL_SCOPE, [host("a"), host("b")])).toEqual({
      acrossHosts: true,
      hostId: ALL_HOSTS,
      hostIds: ["a", "b"],
    });
  });

  test("with no scope and one host, that host is read; with none, nothing", () => {
    expect(hostScope(ALL_SCOPE, [host("a")])).toEqual({
      acrossHosts: false,
      hostId: "a",
      hostIds: ["a"],
    });
    expect(hostScope(ALL_SCOPE, [])).toEqual({ acrossHosts: false, hostId: "", hostIds: [] });
  });

  test("a project scope reads the hosts like no scope does", () => {
    const project: DataScope = { kind: "project", projectKey: "p" };
    expect(hostScope(project, [host("a"), host("b")]).hostIds).toEqual(["a", "b"]);
  });
});

describe("costs-scope: the scope a route asks for", () => {
  test("every host for the all-hosts marker, one host for a host, none for no host", () => {
    expect(routeScopeOf(ALL_HOSTS)).toEqual(ALL_SCOPE);
    expect(routeScopeOf("h1")).toEqual({ kind: "host", hostId: "h1" });
    expect(routeScopeOf(null)).toBeNull();
  });
});

describe("costs-scope: the scoped host with no numbers to show", () => {
  test("an offline scoped host that reports nothing is the away host", () => {
    const away = host("b", "offline");
    expect(awayHost(scoped("b"), [host("a"), away], [host("a")])).toBe(away);
  });

  test("a host still connecting is not away yet", () => {
    expect(awayHost(scoped("b"), [host("b", "connecting")], [])).toBeNull();
  });

  test("a scoped host that reports costs is not away", () => {
    expect(awayHost(scoped("b"), [host("b")], [host("b")])).toBeNull();
  });

  test("a scope that is no host, or a host nobody knows, has no away host", () => {
    expect(awayHost(ALL_SCOPE, [host("a", "offline")], [])).toBeNull();
    expect(awayHost(scoped("ghost"), [host("a", "offline")], [])).toBeNull();
  });
});

describe("costs-scope: the model that cost the most", () => {
  test("is the dearest of the list, whatever its order", () => {
    const list = [
      { model: "haiku", costUsd: 1 },
      { model: "opus", costUsd: 9 },
      { model: "sonnet", costUsd: 4 },
    ];
    expect(topModel(list)?.model).toBe("opus");
  });

  test("leaves the list as it was, and is nothing for an empty list", () => {
    const list = [
      { model: "a", costUsd: 1 },
      { model: "b", costUsd: 2 },
    ];
    topModel(list);
    expect(list.map((m) => m.model)).toEqual(["a", "b"]);
    expect(topModel([])).toBeUndefined();
  });
});
