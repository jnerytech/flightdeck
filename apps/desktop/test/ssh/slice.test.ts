import { describe, expect, test } from "bun:test";
import type { AskpassRequest, SshTarget } from "@flightdeck/protocol";
import { initialSshState, type SshCore, SshSlice } from "../../src/features/ssh/index.ts";
import { sshTarget } from "./daemon.ts";

const request = (secretRef: string | null, requestId = "r1"): AskpassRequest => ({
  type: "askpass.request",
  requestId,
  targetId: "t1",
  targetName: "web",
  kind: "password",
  secretRef,
  prompt: "deploy@web's password:",
});

/** A slice over a bare state and a fake host that keeps destinos in memory and logs what it got. */
function slice(
  options: { kept?: SshTarget[]; refuse?: boolean; vault?: Record<string, string> } = {},
) {
  let state = initialSshState();
  const kept = [...(options.kept ?? [])];
  const saved: Array<Record<string, unknown>> = [];
  const answered: Array<{ hostId: string; requestId: string; secret: string | null }> = [];
  const connected: Array<Record<string, unknown>> = [];
  const vault = options.vault ?? {};
  const core: SshCore = {
    state: () => state,
    update: (patch) => {
      state = { ...state, ...patch };
    },
    list: async () => (options.refuse ? null : { targets: kept }),
    peek: async () => (options.refuse ? null : { targets: kept }),
    save: async (_host, payload) => {
      saved.push(payload);
      const made = sshTarget({ id: `copy-${saved.length}`, name: payload.name ?? "?" });
      kept.push(made);
      return made;
    },
    connect: async (_host, payload) => {
      connected.push(payload);
      return { terminalId: "term-1" } as never;
    },
    answer: async (hostId, requestId, secret) => {
      answered.push({ hostId, requestId, secret });
    },
    hasSecret: (id) => id in vault,
    secretFor: async (_host, id) =>
      vault[id] === "refused" ? { ok: false, code: "host" } : { ok: true, value: vault[id] ?? "" },
  };
  return { ssh: new SshSlice(core), state: () => state, saved, answered, connected };
}

describe("the ssh slice", () => {
  test("a prompt waits for the person, and an answer sends the secret and leaves the list", async () => {
    const s = slice();
    await s.ssh.onAskpass("h1", request(null, "r1"));
    await s.ssh.onAskpass("h1", request(null, "r2"));
    expect(s.state().askpass.map((a) => a.request.requestId)).toEqual(["r1", "r2"]);
    await s.ssh.answer("h1", "r1", "hunter2");
    expect(s.state().askpass.map((a) => a.request.requestId)).toEqual(["r2"]);
    expect(s.answered).toEqual([{ hostId: "h1", requestId: "r1", secret: "hunter2" }]);
  });

  test("a prompt that points at a deliverable vault secret is answered with no one asked", async () => {
    const s = slice({ vault: { sec1: "from-vault" } });
    await s.ssh.onAskpass("h1", request("sec1"));
    expect(s.state().askpass).toEqual([]);
    expect(s.answered).toEqual([{ hostId: "h1", requestId: "r1", secret: "from-vault" }]);
  });

  test("a vault secret the rules refuse, or one the vault lacks, leaves the prompt to the person", async () => {
    const s = slice({ vault: { sec1: "refused" } });
    await s.ssh.onAskpass("h1", request("sec1", "r1"));
    await s.ssh.onAskpass("h1", request("gone", "r2"));
    expect(s.state().askpass.map((a) => a.request.requestId)).toEqual(["r1", "r2"]);
    expect(s.answered).toEqual([]);
  });

  test("the palette's destinos come from the host, and stay as they were when it cannot say", async () => {
    const web = sshTarget({ id: "t1", name: "web" });
    const s = slice({ kept: [web] });
    await s.ssh.loadTargets("h1");
    expect(s.state().ssh).toEqual({ h1: [web] });
    const down = slice({ refuse: true });
    await down.ssh.loadTargets("h1");
    expect(down.state().ssh).toEqual({});
  });

  test("a copy on another host brings its jump along, and updates the one it has by name", async () => {
    const bastion = sshTarget({ id: "b1", name: "bastion" });
    const web = sshTarget({ id: "t1", name: "web", jump: "b1" });
    const s = slice({ kept: [sshTarget({ id: "old", name: "web" })] });
    const copy = await s.ssh.copyTo("runner", web, [web, bastion]);
    expect(copy?.name).toBe("web");
    expect(s.saved.map((p) => [p.name, p.id ?? null, p.jump, p.viaHost])).toEqual([
      ["bastion", null, null, null],
      ["web", "old", "copy-1", null],
    ]);
    const down = slice({ refuse: true });
    expect(await down.ssh.copyTo("runner", web, [web, bastion])).toBeNull();
  });

  test("a terminal opened from a destino is remembered by its host and id, with the key for that run", async () => {
    const web = sshTarget({ id: "t1", name: "web", tags: ["prod"] });
    const s = slice();
    expect(await s.ssh.connect("h1", web, "KEY")).toBe("term-1");
    expect(s.connected).toEqual([{ targetId: "t1", cols: 80, rows: 24, privateKey: "KEY" }]);
    expect(s.ssh.terminals.get("h1/term-1")).toEqual({ name: "web", tags: ["prod"] });
  });
});
