import { describe, expect, test } from "bun:test";
import { ClientScope } from "../src/lib/client-scope.ts";
import {
  effectiveRules,
  generatedScopeRules,
  SCOPE_RULE_PREFIX,
  scopingClient,
  vaultFindings,
} from "../src/lib/client-vault.ts";
import type { Client } from "../src/lib/clients.ts";
import type { SecretMeta } from "../src/lib/vault.ts";

const client = (
  id: string,
  defaults: Partial<Client["defaults"]> = {},
  pattern = `github.com/${id}/*`,
): Client => ({
  id,
  name: id,
  color: "indigo",
  rules: [{ id: `r-${id}`, kind: "remote", pattern }],
  defaults: { vaultScope: false, ...defaults },
});
const secret = (id: string, tags: string[], allowedHosts: string[] = []): SecretMeta => ({
  id,
  name: `secret-${id}`,
  type: "token",
  description: "",
  tags,
  createdAt: 0,
  lastUsedAt: null,
  allowedHosts,
});

describe("clients-vault: which client keeps a secret", () => {
  const acme = client("acme", { vaultTag: "client:acme", vaultScope: true });
  const beta = client("beta", { vaultTag: "client:beta", vaultScope: false });

  test("the first client with scope on whose tag the secret carries", () => {
    expect(scopingClient({ tags: ["x", "client:acme"] }, [beta, acme])?.id).toBe("acme");
  });

  test("a tag of a client that has not turned scope on keeps nothing", () => {
    expect(scopingClient({ tags: ["client:beta"] }, [acme, beta])).toBeNull();
  });

  test("a secret with no client tag, or a client with no tag, is nobody's", () => {
    expect(scopingClient({ tags: [] }, [acme])).toBeNull();
    expect(
      scopingClient({ tags: ["client:acme"] }, [client("c", { vaultScope: true })]),
    ).toBeNull();
  });
});

describe("clients-vault: the rules generated for a scoped secret", () => {
  const P1 = "github.com/acme/api";
  const P2 = "github.com/acme/web";
  const denies = (rules: unknown[]) =>
    rules.filter((r) => (r as { decision: string }).decision === "deny");

  test("a secret with no rules is asked for in each of the client's projects, and denied to the rest", () => {
    expect(generatedScopeRules({ id: "acme" }, [P1, P2], [])).toEqual([
      { id: `${SCOPE_RULE_PREFIX}acme:0`, match: { project: P1 }, decision: "ask" },
      { id: `${SCOPE_RULE_PREFIX}acme:1`, match: { project: P2 }, decision: "ask" },
      {
        id: `${SCOPE_RULE_PREFIX}acme:deny:claude`,
        match: { requester: "claude" },
        decision: "deny",
      },
      {
        id: `${SCOPE_RULE_PREFIX}acme:deny:automation`,
        match: { requester: "automation" },
        decision: "deny",
      },
      {
        id: `${SCOPE_RULE_PREFIX}acme:deny:workflow`,
        match: { requester: "workflow" },
        decision: "deny",
      },
    ]);
  });

  test("the requester you is never denied by what is generated", () => {
    const rules = generatedScopeRules({ id: "acme" }, [P1], []);
    expect(
      denies(rules).map((r) => (r as { match: { requester: string } }).match.requester),
    ).toEqual(["claude", "automation", "workflow"]);
  });

  test("the own rules are copied into each project, keeping their decision and conditions", () => {
    const own = [
      { id: "mine", match: { purpose: "ssh", host: "alfa" }, decision: "ask", once: "session" },
    ];
    const rules = generatedScopeRules({ id: "acme" }, [P1, P2], own);
    expect(rules.slice(0, 2)).toEqual([
      {
        id: `${SCOPE_RULE_PREFIX}acme:0:0`,
        match: { purpose: "ssh", host: "alfa", project: P1 },
        decision: "ask",
        once: "session",
      },
      {
        id: `${SCOPE_RULE_PREFIX}acme:1:0`,
        match: { purpose: "ssh", host: "alfa", project: P2 },
        decision: "ask",
        once: "session",
      },
    ]);
    expect(denies(rules)).toHaveLength(3);
  });

  test("an own rule for another project is not copied into this one, and a broken rule is left alone", () => {
    const own = [{ id: "a", match: { project: P2 }, decision: "allow" }, "not a rule"];
    const rules = generatedScopeRules({ id: "acme" }, [P1, P2], own);
    const copies = rules.filter((r) => /:\d+:\d+$/.test((r as { id?: string }).id ?? ""));
    expect(copies).toEqual([
      { id: `${SCOPE_RULE_PREFIX}acme:1:0`, match: { project: P2 }, decision: "allow" },
    ]);
  });

  test("with no project of the client yet, only the denials are generated", () => {
    expect(generatedScopeRules({ id: "acme" }, [], [])).toHaveLength(3);
  });
});

describe("clients-vault: what the daemon is sent", () => {
  const acme = client("acme", { vaultTag: "client:acme", vaultScope: true });
  const own = [{ id: "mine", match: {}, decision: "ask" }];

  test("a scoped secret gets the client's rules in front of its own", () => {
    const rules = effectiveRules({ tags: ["client:acme"] }, own, [acme], () => [
      "github.com/acme/api",
    ]);
    expect((rules.at(-1) as { id: string }).id).toBe("mine");
    expect((rules[0] as { id: string }).id.startsWith(SCOPE_RULE_PREFIX)).toBe(true);
    expect(rules).toHaveLength(5);
  });

  test("any other secret is sent its own rules as they are", () => {
    expect(effectiveRules({ tags: [] }, own, [acme], () => [])).toEqual(own);
  });
});

describe("clients-vault: what could take a secret out of its client", () => {
  const acme = client("acme", { vaultTag: "client:acme" });
  const beta = client("beta");
  const scope = new ClientScope({ clients: [acme, beta], overrides: {} }, []);
  const find = (secrets: SecretMeta[], rules: Record<string, unknown[]>, holdingHosts = ["h1"]) =>
    vaultFindings({
      client: acme,
      secrets,
      rulesOf: (id) => rules[id] ?? [],
      scope,
      holdingHosts,
    });

  test("a rule that lets or asks for a project of another client is named", () => {
    const found = find([secret("s1", ["client:acme"], ["h1"])], {
      s1: [
        { id: "a", match: { project: "github.com/beta/app" }, decision: "allow" },
        { id: "b", match: { project: "github.com/beta/app" }, decision: "ask" },
        { id: "c", match: { project: "github.com/acme/api" }, decision: "allow" },
        { id: "d", match: { project: "github.com/beta/other" }, decision: "deny" },
        { id: "e", match: {}, decision: "allow" },
      ],
    });
    expect(found).toEqual([
      {
        secretId: "s1",
        secretName: "secret-s1",
        kind: "rule-reaches-other-client",
        detail: ["github.com/beta/app"],
      },
    ]);
  });

  test("hosts that hold none of the client's projects are named", () => {
    const found = find([secret("s1", ["client:acme"], ["h1", "h2"])], {}, ["h1"]);
    expect(found).toEqual([
      { secretId: "s1", secretName: "secret-s1", kind: "hosts-wider", detail: ["h2"] },
    ]);
  });

  test("with no host known to hold the client's projects, hosts are not judged", () => {
    expect(find([secret("s1", ["client:acme"], ["h2"])], {}, [])).toEqual([]);
  });

  test("a secret without the client's tag is not looked at", () => {
    expect(
      find([secret("s1", ["client:beta"], ["h9"])], {
        s1: [{ id: "a", match: { project: "github.com/beta/app" }, decision: "allow" }],
      }),
    ).toEqual([]);
  });

  test("a client with no vault tag has nothing to look at", () => {
    const found = vaultFindings({
      client: beta,
      secrets: [secret("s1", [], ["h9"])],
      rulesOf: () => [],
      scope,
      holdingHosts: ["h1"],
    });
    expect(found).toEqual([]);
  });
});
