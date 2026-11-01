import { describe, expect, test } from "bun:test";
import { ALL_CLIENTS, ClientScope } from "../src/lib/client-scope.ts";
import { switcherCounts } from "../src/lib/client-switcher.ts";
import { type Client, UNASSIGNED } from "../src/lib/clients.ts";

const client = (id: string, pattern: string): Client => ({
  id,
  name: id,
  color: "indigo",
  rules: [{ id: `r-${id}`, kind: "remote", pattern }],
  defaults: { vaultScope: false },
});
const projects = [
  "github.com/acme/api",
  "github.com/beta/app",
  "github.com/other/x",
  "github.com/other/y",
].map((key) => ({ key, cwds: [] }));
const scope = new ClientScope(
  {
    clients: [client("acme", "github.com/acme/*"), client("beta", "github.com/beta/*")],
    overrides: {},
  },
  projects,
);
const row = (
  state: string,
  projectKey: string,
  sessionId: string,
  claudeSessionId: string | null = null,
) => ({
  state,
  projectKey,
  sessionId,
  claudeSessionId,
});

describe("clients-ui: what the switcher counts", () => {
  const rows = [
    row("running", "github.com/acme/api", "a1"),
    row("needs_you", "github.com/acme/api", "a2"),
    row("idle", "github.com/acme/api", "a3"),
    row("ended", "github.com/beta/app", "b1"),
    row("running", "github.com/other/x", "o1"),
  ];

  test("running and waiting sessions are counted by client, the others are not", () => {
    expect(switcherCounts(scope, rows, [], ALL_CLIENTS).busy).toEqual({
      acme: 2,
      [UNASSIGNED]: 1,
    });
  });

  test("the projects with no client are counted", () => {
    expect(switcherCounts(scope, rows, [], ALL_CLIENTS).projects).toBe(2);
  });

  test("with all clients shown nothing waits in 'others'", () => {
    const pending = [{ sessionId: "a2" }];
    expect(switcherCounts(scope, rows, pending, ALL_CLIENTS).othersWaiting).toBe(0);
  });

  test("a request in a client other than the selected one is counted, and one the app cannot place belongs to Unassigned", () => {
    const withBeta = [...rows, row("needs_you", "github.com/beta/app", "b2", "claude-b2")];
    const pending = [{ sessionId: "a2" }, { sessionId: "claude-b2" }, { sessionId: "gate-card" }];
    expect(switcherCounts(scope, withBeta, pending, "acme").othersWaiting).toBe(2);
    expect(switcherCounts(scope, withBeta, pending, "beta").othersWaiting).toBe(2);
    expect(switcherCounts(scope, withBeta, pending, UNASSIGNED).othersWaiting).toBe(2);
  });
});
