import { describe, expect, test } from "bun:test";
import {
  type TargetInput,
  WebhookTargetError,
  WebhookTargets,
} from "../src/lib/webhook-targets.ts";

const SLACK_URL = "https://hooks.slack.com/services/T000/B000/XXXXSECRETXXXX";

function setup() {
  const store = new Map<string, string>();
  const vault = new Map<string, string>();
  const platform = {
    storage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
    vault: {
      get: async (id: string) => vault.get(id) ?? null,
      set: async (id: string, value: string) => void vault.set(id, value),
      delete: async (id: string) => void vault.delete(id),
    },
  } as never;
  let n = 0;
  const make = () => new WebhookTargets(platform, { newId: () => `t${++n}`, clock: () => 1000 });
  return { store, vault, platform, targets: make(), make };
}

const input = (over: Partial<TargetInput> = {}): TargetInput => ({
  name: "Team channel",
  type: "slack",
  url: SLACK_URL,
  hostScope: null,
  kinds: ["needs_you", "session_failed"],
  clientId: null,
  ...over,
});

const code = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (error) {
    return error instanceof WebhookTargetError ? error.code : "other";
  }
  return "none";
};

describe("webhook-alvos", () => {
  test("add keeps the target, shows only the URL host and starts as new", async () => {
    const { targets } = setup();
    const target = await targets.add(input());
    expect(target).toEqual({
      id: "t1",
      name: "Team channel",
      type: "slack",
      hostScope: null,
      kinds: ["needs_you", "session_failed"],
      clientId: null,
      enabled: true,
      urlHost: "hooks.slack.com",
      status: "new",
      lastHttpStatus: null,
      lastAt: null,
    });
    expect(targets.list()).toEqual([target]);
  });

  test("the URL and the signing secret are in the vault and nowhere in the stored list", async () => {
    const { targets, store, vault } = setup();
    await targets.add(
      input({
        type: "generic",
        url: "https://example.com/hook?k=abc123",
        signingSecret: "sign-me",
      }),
    );
    const stored = [...store.values()].join("\n");
    for (const secret of ["abc123", "sign-me", "/hook", SLACK_URL])
      expect(stored).not.toContain(secret);
    expect(JSON.stringify(targets.list())).not.toContain("abc123");
    expect(await targets.secrets("t1")).toEqual({
      url: "https://example.com/hook?k=abc123",
      signingSecret: "sign-me",
    });
    expect([...vault.keys()].sort()).toEqual(["webhook-sign:t1", "webhook:t1"]);
  });

  test("a target without a signing secret has none", async () => {
    const { targets } = setup();
    await targets.add(input());
    expect(await targets.secrets("t1")).toEqual({ url: SLACK_URL, signingSecret: null });
    expect(await targets.secrets("nope")).toBeNull();
  });

  test("the list survives a restart and a corrupt value gives an empty list", async () => {
    const { targets, make, store } = setup();
    await targets.add(input());
    expect(
      make()
        .list()
        .map((t) => t.id),
    ).toEqual(["t1"]);
    for (const bad of ["{not json", "42", '{"a":1}', '[{"id":1}]']) {
      store.set("flightdeck.webhooks", bad);
      expect(make().list()).toEqual([]);
    }
  });

  test("the URL must be https, except http to loopback, and carry no credentials", async () => {
    const { targets } = setup();
    expect(await code(() => targets.add(input({ url: "http://example.com/h" })))).toBe("not_https");
    expect(await code(() => targets.add(input({ url: "ftp://example.com/h" })))).toBe("not_https");
    expect(await code(() => targets.add(input({ url: "not a url" })))).toBe("invalid_url");
    expect(await code(() => targets.add(input({ url: "https://user:pw@example.com/h" })))).toBe(
      "invalid_url",
    );
    for (const url of ["http://127.0.0.1:8080/h", "http://localhost:9/h", "http://[::1]:9/h"]) {
      expect((await targets.add(input({ url }))).urlHost).toMatch(/127\.0\.0\.1|localhost|::1/);
    }
    expect(targets.list()).toHaveLength(3);
  });

  test("a name and at least one kind are required", async () => {
    const { targets } = setup();
    expect(await code(() => targets.add(input({ name: "  " })))).toBe("no_name");
    expect(await code(() => targets.add(input({ kinds: [] })))).toBe("no_kinds");
  });

  test("update changes the fields, replaces the secrets only when given, and can disable", async () => {
    const { targets, vault } = setup();
    await targets.add(input({ type: "generic", signingSecret: "old" }));
    const renamed = await targets.update("t1", {
      name: "Renamed",
      enabled: false,
      kinds: ["budget_alert"],
    });
    expect(renamed).toMatchObject({ name: "Renamed", enabled: false, kinds: ["budget_alert"] });
    expect(vault.get("webhook:t1")).toBe(SLACK_URL);
    await targets.update("t1", { url: "https://example.org/new", signingSecret: "new" });
    expect(vault.get("webhook:t1")).toBe("https://example.org/new");
    expect(vault.get("webhook-sign:t1")).toBe("new");
    expect(targets.list()[0]?.urlHost).toBe("example.org");
    expect(await code(() => targets.update("t1", { url: "http://example.org/x" }))).toBe(
      "not_https",
    );
    expect(await code(() => targets.update("zzz", { name: "x" }))).toBe("not_found");
  });

  test("remove deletes the target and both vault values", async () => {
    const { targets, vault } = setup();
    await targets.add(input({ type: "generic", signingSecret: "k" }));
    await targets.remove("t1");
    expect(targets.list()).toEqual([]);
    expect(vault.size).toBe(0);
    await targets.remove("t1");
  });

  test("record marks a target ok or failing with the last status and time", async () => {
    const { targets } = setup();
    await targets.add(input());
    targets.record("t1", { ok: false, httpStatus: 404 });
    expect(targets.list()[0]).toMatchObject({
      status: "failing",
      lastHttpStatus: 404,
      lastAt: "1970-01-01T00:00:01.000Z",
    });
    targets.record("t1", { ok: true, httpStatus: 200 });
    expect(targets.list()[0]).toMatchObject({ status: "ok", lastHttpStatus: 200 });
    targets.record("zzz", { ok: true, httpStatus: 200 });
  });

  test("matching: enabled, the kind, the host scope and the client", async () => {
    const { targets } = setup();
    await targets.add(input({ name: "all", kinds: ["needs_you"] }));
    await targets.add(input({ name: "pi only", kinds: ["needs_you"], hostScope: "pi" }));
    await targets.add(input({ name: "acme", kinds: ["needs_you"], clientId: "acme" }));
    await targets.add(input({ name: "budget", kinds: ["budget_alert"] }));
    await targets.add(input({ name: "off", kinds: ["needs_you"] }));
    await targets.update("t5", { enabled: false });
    const names = (hostId: string, clientId: string | null, kind = "needs_you" as const) =>
      targets.matching({ kind, hostId, clientId }).map((t) => t.name);
    expect(names("pi", null)).toEqual(["all", "pi only"]);
    expect(names("laptop", null)).toEqual(["all"]);
    expect(names("laptop", "acme")).toEqual(["all", "acme"]);
    expect(
      targets.matching({ kind: "budget_alert", hostId: "x", clientId: null }).map((t) => t.name),
    ).toEqual(["budget"]);
  });

  test("without an id source each target gets its own id", async () => {
    const { platform } = setup();
    const targets = new WebhookTargets(platform);
    const a = await targets.add(input());
    const b = await targets.add(input({ name: "other" }));
    expect(a.id).not.toBe(b.id);
    expect(a.id.length).toBeGreaterThan(8);
  });
});
