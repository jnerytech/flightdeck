import { describe, expect, test } from "bun:test";
import {
  type KnownProject,
  knownProjects,
  projectsMatching,
  resolveClient,
  ruleMatches,
} from "../src/lib/client-rules.ts";
import { type Client, type ClientRule, UNASSIGNED } from "../src/lib/clients.ts";

const remote = (pattern: string): ClientRule => ({ id: `r:${pattern}`, kind: "remote", pattern });
const folder = (path: string, host?: string): ClientRule => ({
  id: `f:${path}`,
  kind: "folder",
  path,
  ...(host ? { host } : {}),
});
const client = (id: string, ...rules: ClientRule[]): Client => ({
  id,
  name: id,
  color: "indigo",
  rules,
  defaults: { vaultScope: false },
});
const project = (key: string, ...cwds: Array<[string, string]>): KnownProject => ({
  key,
  cwds: cwds.map(([hostId, path]) => ({ hostId, path })),
});
const resolve = (
  p: KnownProject,
  clients: Client[],
  overrides: Record<string, string | null> = {},
) => resolveClient(p, { clients, overrides });

describe("clients-rules: a remote rule", () => {
  test("a trailing * claims every repository under the prefix, and nothing else", () => {
    const rule = remote("github.com/acme/*");
    expect(ruleMatches(rule, project("github.com/acme/api"))).toBe(true);
    expect(ruleMatches(rule, project("github.com/acme/api/sub"))).toBe(true);
    expect(ruleMatches(rule, project("github.com/acme"))).toBe(false);
    expect(ruleMatches(rule, project("github.com/acmecorp/api"))).toBe(false);
    expect(ruleMatches(rule, project("gitlab.com/acme/api"))).toBe(false);
  });

  test("without a * it claims that repository only, and case does not matter", () => {
    const rule = remote("github.com/acme/api");
    expect(ruleMatches(rule, project("github.com/acme/api"))).toBe(true);
    expect(ruleMatches(rule, project("GitHub.com/Acme/API"))).toBe(true);
    expect(ruleMatches(rule, project("github.com/acme/api2"))).toBe(false);
    expect(ruleMatches(rule, project("github.com/acme/api/x"))).toBe(false);
  });

  test("an Azure DevOps organization is a prefix like any other", () => {
    const rule = remote("dev.azure.com/orgb/*");
    expect(ruleMatches(rule, project("dev.azure.com/orgb/proj/_git/repo"))).toBe(true);
    expect(ruleMatches(rule, project("dev.azure.com/orgc/proj/_git/repo"))).toBe(false);
  });

  test("a project known only by its folder is never claimed by a remote rule", () => {
    expect(ruleMatches(remote("*"), project("host:alfa:/home/me/acme"))).toBe(false);
    expect(ruleMatches(remote("host:alfa:/home/*"), project("host:alfa:/home/me/acme"))).toBe(
      false,
    );
  });
});

describe("clients-rules: a folder rule", () => {
  test("claims a project whose key is a folder inside the prefix", () => {
    const rule = folder("/home/me/work/acme");
    expect(ruleMatches(rule, project("host:alfa:/home/me/work/acme"))).toBe(true);
    expect(ruleMatches(rule, project("host:alfa:/home/me/work/acme/web"))).toBe(true);
    expect(ruleMatches(rule, project("host:alfa:/home/me/work/acme2"))).toBe(false);
    expect(ruleMatches(rule, project("host:alfa:/home/me/work"))).toBe(false);
  });

  test("claims a remote-keyed project when any folder it ran in is inside the prefix", () => {
    const rule = folder("/home/me/work/acme");
    const p = project(
      "github.com/acme/api",
      ["beta", "/srv/api"],
      ["alfa", "/home/me/work/acme/api"],
    );
    expect(ruleMatches(rule, p)).toBe(true);
    expect(ruleMatches(rule, project("github.com/acme/api", ["beta", "/srv/api"]))).toBe(false);
    expect(ruleMatches(rule, project("github.com/acme/api"))).toBe(false);
  });

  test("a host in the rule limits it to the folders of that host", () => {
    const rule = folder("/home/me/work", "alfa");
    expect(ruleMatches(rule, project("host:alfa:/home/me/work/x"))).toBe(true);
    expect(ruleMatches(rule, project("host:beta:/home/me/work/x"))).toBe(false);
    expect(ruleMatches(rule, project("github.com/a/b", ["beta", "/home/me/work/x"]))).toBe(false);
    expect(ruleMatches(rule, project("github.com/a/b", ["alfa", "/home/me/work/x"]))).toBe(true);
  });

  test("Windows paths match in any case and with either separator", () => {
    const rule = folder("C:\\Work\\Acme");
    expect(ruleMatches(rule, project("host:win:c:/work/acme/api"))).toBe(true);
    expect(ruleMatches(rule, project("host:win:C:\\WORK\\ACME\\api"))).toBe(true);
    expect(ruleMatches(rule, project("host:win:C:\\Work\\Acmeish"))).toBe(false);
  });
});

describe("clients-rules: which client a project belongs to", () => {
  const acme = client("acme", remote("github.com/acme/*"));
  const beta = client("beta", remote("github.com/acme/*"), folder("/work/beta"));

  test("the first client in order with a matching rule wins, and the order can change it", () => {
    const p = project("github.com/acme/api");
    expect(resolve(p, [acme, beta])).toEqual({
      clientId: "acme",
      via: "rule",
      ruleId: "r:github.com/acme/*",
      conflict: [],
    });
    expect(resolve(p, [beta, acme]).clientId).toBe("beta");
  });

  test("a project no rule claims is Unassigned", () => {
    expect(resolve(project("github.com/other/x"), [acme, beta])).toEqual({
      clientId: UNASSIGNED,
      via: "none",
      ruleId: null,
      conflict: [],
    });
    expect(resolve(project("host:alfa:/tmp/x"), [])).toEqual({
      clientId: UNASSIGNED,
      via: "none",
      ruleId: null,
      conflict: [],
    });
  });

  test("a manual override beats the rules, to a client or to Unassigned", () => {
    const p = project("github.com/acme/api");
    expect(resolve(p, [acme, beta], { "github.com/acme/api": "beta" })).toEqual({
      clientId: "beta",
      via: "override",
      ruleId: null,
      conflict: [],
    });
    expect(resolve(p, [acme], { "github.com/acme/api": null })).toEqual({
      clientId: UNASSIGNED,
      via: "override",
      ruleId: null,
      conflict: [],
    });
  });

  test("an override to a client that is gone is ignored", () => {
    const p = project("github.com/acme/api");
    expect(resolve(p, [acme], { "github.com/acme/api": "ghost" }).clientId).toBe("acme");
  });

  test("two folders of one project that belong to two clients are flagged, and the first client wins", () => {
    const a = client("a", folder("/work/a"));
    const b = client("b", folder("/work/b"));
    const p = project("github.com/x/y", ["h", "/work/b/y"], ["h", "/work/a/y"]);
    expect(resolve(p, [a, b])).toEqual({
      clientId: "a",
      via: "rule",
      ruleId: "f:/work/a",
      conflict: ["b"],
    });
    expect(resolve(p, [b, a]).clientId).toBe("b");
  });

  test("two rules of different clients on the same key are not a conflict", () => {
    const p = project("github.com/acme/api");
    expect(resolve(p, [acme, beta]).conflict).toEqual([]);
  });
});

describe("clients-rules: the projects a rule claims", () => {
  const projects = [
    project("github.com/acme/api"),
    project("github.com/acme/web"),
    project("github.com/other/x"),
    project("host:alfa:/home/me/acme"),
  ];

  test("lists them, for the preview of a rule that has no id yet", () => {
    expect(
      projectsMatching({ kind: "remote", pattern: "github.com/acme/*" }, projects).map(
        (p) => p.key,
      ),
    ).toEqual(["github.com/acme/api", "github.com/acme/web"]);
    expect(
      projectsMatching({ kind: "folder", path: "/home/me" }, projects).map((p) => p.key),
    ).toEqual(["host:alfa:/home/me/acme"]);
    expect(projectsMatching({ kind: "remote", pattern: "nope/*" }, projects)).toEqual([]);
  });
});

describe("clients-rules: the projects the app knows", () => {
  test("each key keeps the distinct folders, per host, its sessions ran in", () => {
    const rows = [
      { hostId: "alfa", cwd: "/work/api", projectKey: "github.com/acme/api" },
      { hostId: "alfa", cwd: "/work/api", projectKey: "github.com/acme/api" },
      { hostId: "beta", cwd: "/srv/api", projectKey: "github.com/acme/api" },
      { hostId: "alfa", cwd: "/work/api", projectKey: "github.com/acme/api" },
      { hostId: "alfa", cwd: "", projectKey: "github.com/acme/web" },
      { hostId: "beta", cwd: "/tmp/x", projectKey: "host:beta:/tmp/x" },
    ];
    expect(knownProjects(rows)).toEqual([
      {
        key: "github.com/acme/api",
        cwds: [
          { hostId: "alfa", path: "/work/api" },
          { hostId: "beta", path: "/srv/api" },
        ],
      },
      { key: "github.com/acme/web", cwds: [] },
      { key: "host:beta:/tmp/x", cwds: [{ hostId: "beta", path: "/tmp/x" }] },
    ]);
  });
});
