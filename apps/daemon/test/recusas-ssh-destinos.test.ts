import { describe, expect, test } from "bun:test";
import { type SshTargetInput, SshTargets } from "../src/ssh/targets.ts";
import { EventStore } from "../src/store/event-store.ts";

function setup() {
  const store = new EventStore(":memory:");
  const targets = new SshTargets({ db: store.db });
  return { targets };
}
const base = (extra: Partial<SshTargetInput> = {}): SshTargetInput => ({
  name: "vps",
  host: "vps.example.com",
  user: "deploy",
  ...extra,
});

/** What a refusal carries: the code, the reason the app translates, its params and the log text. */
function refusal(fn: () => unknown) {
  try {
    fn();
    return null;
  } catch (error) {
    const { code, reason, params, message } = error as {
      code: string;
      reason?: string;
      params?: Record<string, string | number>;
      message: string;
    };
    return { code, reason, params, message };
  }
}

describe("recusas-ssh-destinos: a destination the host refuses says why, as a reason", () => {
  const cases: Array<[string, (t: SshTargets) => unknown, Record<string, string | number>]> = [
    ["ssh_target_not_found", (t) => t.save(base({ id: "nope" })), {}],
    ["ssh_name_invalid", (t) => t.save(base({ name: "  " })), {}],
    ["ssh_host_invalid", (t) => t.save(base({ host: "bad host!" })), {}],
    ["ssh_user_invalid", (t) => t.save(base({ user: "bad user!" })), {}],
    ["ssh_port_invalid", (t) => t.save(base({ port: 70_000 })), {}],
    ["ssh_forward_agent_confirm", (t) => t.save(base({ options: { forwardAgent: true } })), {}],
    ["ssh_key_path_needed", (t) => t.save(base({ auth: "key-file" })), {}],
    ["ssh_vault_key_needed", (t) => t.save(base({ auth: "vault-key" })), {}],
    [
      "ssh_secret_ref_invalid",
      (t) => t.save(base({ auth: "key-file", secretRef: "-oProxyCommand=x" })),
      {},
    ],
    ["ssh_jump_unknown", (t) => t.save(base({ jump: "nope" })), {}],
    ["ssh_alive_range", (t) => t.save(base({ options: { serverAliveInterval: 0 } })), {}],
    [
      "ssh_forward_too_many",
      (t) => t.save(base({ options: { localForward: Array.from({ length: 11 }, () => "1:h:2") } })),
      {},
    ],
    [
      "ssh_forward_invalid",
      (t) => t.save(base({ options: { localForward: ["nonsense"] } })),
      { forward: "nonsense" },
    ],
    [
      "ssh_too_many_tags",
      (t) => t.save(base({ tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })),
      { max: 10 },
    ],
    ["ssh_tag_invalid", (t) => t.save(base({ tags: ["a,b"] })), {}],
  ];
  for (const [reason, run, params] of cases) {
    test(`${reason}: the reason and params are set and the message is English`, () => {
      const { targets } = setup();
      const got = refusal(() => run(targets));
      expect(got?.reason).toBe(reason);
      expect(got?.params).toEqual(params);
      expect(got?.message).not.toMatch(/[À-ú]|\b(destino|inválid[oa]|porta|usuário)\b/);
    });
  }

  test("removing: an unknown destination, without confirmation, and one that is another's jump", () => {
    const { targets } = setup();
    expect(refusal(() => targets.remove("nope", true))).toMatchObject({
      code: "not_found",
      reason: "ssh_target_not_found",
    });
    const hop = targets.save(base({ name: "hop" }));
    targets.save(base({ name: "behind", jump: hop.id }));
    expect(refusal(() => targets.remove(hop.id, false))).toMatchObject({
      code: "invalid_state",
      reason: "ssh_remove_confirm",
    });
    expect(refusal(() => targets.remove(hop.id, true))).toMatchObject({
      code: "invalid_state",
      reason: "ssh_jump_in_use",
      params: { name: "behind" },
    });
  });

  test("a jump that closes a cycle is refused as one", () => {
    const { targets } = setup();
    const a = targets.save(base({ name: "a" }));
    const b = targets.save(base({ name: "b", jump: a.id }));
    expect(refusal(() => targets.save(base({ id: a.id, name: "a", jump: b.id })))).toMatchObject({
      code: "bad_request",
      reason: "ssh_jump_cycle",
    });
  });
});
