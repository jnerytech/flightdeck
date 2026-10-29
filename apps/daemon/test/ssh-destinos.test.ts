import { afterEach, describe, expect, test } from "bun:test";
import { startServer } from "../src/server.ts";
import { type SshTargetInput, SshTargets } from "../src/ssh/targets.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "ssh-targets-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function setup() {
  const store = new EventStore(":memory:");
  let clock = Date.parse("2026-10-29T12:00:00Z");
  const targets = new SshTargets({ db: store.db, now: () => clock });
  return {
    store,
    targets,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

const base = (extra: Partial<SshTargetInput> = {}): SshTargetInput => ({
  name: "vps",
  host: "vps.example.com",
  user: "deploy",
  ...extra,
});

/** The error code of a call that is expected to fail. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "sem código";
  }
}

describe("ssh-destinos", () => {
  test("salvar cria com os padrões, listar ordena por nome e salvar com id atualiza sem mudar o criado em", () => {
    const { targets, tick } = setup();
    const created = targets.save(base({ name: "vps" }));
    expect(created).toMatchObject({
      name: "vps",
      host: "vps.example.com",
      port: 22,
      user: "deploy",
      viaHost: null,
      auth: "agent",
      secretRef: null,
      jump: null,
      options: {},
      tags: [],
      hostKey: null,
      createdAt: "2026-10-29T12:00:00.000Z",
      updatedAt: "2026-10-29T12:00:00.000Z",
    });
    expect(created.id).toMatch(/^[0-9A-Z]{26}$/);
    targets.save(base({ name: "Alfa", host: "alfa.example.com" }));
    expect(targets.list().map((t) => t.name)).toEqual(["Alfa", "vps"]);
    tick(60_000);
    const updated = targets.save({ ...base({ name: "vps novo", port: 2222 }), id: created.id });
    expect(updated).toMatchObject({
      id: created.id,
      name: "vps novo",
      port: 2222,
      createdAt: "2026-10-29T12:00:00.000Z",
      updatedAt: "2026-10-29T12:01:00.000Z",
    });
    expect(targets.list()).toHaveLength(2);
    expect(targets.get(created.id)?.port).toBe(2222);
    expect(targets.get("nada")).toBeNull();
    expect(codeOf(() => targets.save({ ...base(), id: "nada" }))).toBe("not_found");
  });

  test("host, usuário, porta e nome ruins são recusados, em especial o que o ssh leria como opção", () => {
    const { targets } = setup();
    const bad = (extra: Partial<SshTargetInput>) => codeOf(() => targets.save(base(extra)));
    for (const host of ["-oProxyCommand=x", "a b", "", "a;b", "$(x)", "a@b", "x".repeat(300)]) {
      expect([host.slice(0, 20), bad({ host })]).toEqual([host.slice(0, 20), "bad_request"]);
    }
    for (const user of ["-x", "a b", "a@b", "", "a:b", "x".repeat(70)]) {
      expect([user, bad({ user })]).toEqual([user, "bad_request"]);
    }
    for (const port of [0, 65_536, 2.5, -1]) {
      expect([port, bad({ port })]).toEqual([port, "bad_request"]);
    }
    expect(bad({ name: "" })).toBe("bad_request");
    expect(bad({ name: "x".repeat(101) })).toBe("bad_request");
    // What is fine: names, IPv4, IPv6 and a user with dots, dashes and underscores.
    for (const host of ["srv-1.local", "10.0.0.5", "fd7a:115c:a1e0::1", "localhost"]) {
      expect([host, bad({ host })]).toEqual([host, "ok"]);
    }
    expect(bad({ user: "ana.silva_2-x" })).toBe("ok");
  });

  test("a autenticação pede a referência certa: o caminho da chave, o item do cofre, ou nada", () => {
    const { targets } = setup();
    const save = (extra: Partial<SshTargetInput>) => codeOf(() => targets.save(base(extra)));
    expect(save({ auth: "key-file" })).toBe("bad_request");
    for (const secretRef of ["-oProxyCommand=x", "a\nb", "a\u0000b"]) {
      expect([secretRef, save({ auth: "key-file", secretRef })]).toEqual([
        secretRef,
        "bad_request",
      ]);
    }
    expect(save({ auth: "key-file", secretRef: "~/.ssh/id_ed25519" })).toBe("ok");
    expect(save({ auth: "vault-key" })).toBe("bad_request");
    expect(save({ auth: "vault-key", secretRef: "chave-da-vps" })).toBe("ok");
    // A password may come from the vault or be typed when asked: no reference is fine.
    expect(save({ auth: "password" })).toBe("ok");
    expect(save({ auth: "password", secretRef: "senha-da-vps" })).toBe("ok");
    // The agent has nothing to refer to: whatever came along is dropped.
    expect(
      targets.save(base({ name: "ag", auth: "agent", secretRef: "sobrou" })).secretRef,
    ).toBeNull();
  });

  test("o jump aponta para um destino que existe, nunca para ele mesmo nem em ciclo, e quem é jump de outro não sai sem antes", () => {
    const { targets } = setup();
    const bastion = targets.save(base({ name: "bastion", host: "bastion.example.com" }));
    const inner = targets.save(base({ name: "inner", host: "10.0.0.9", jump: bastion.id }));
    expect(inner.jump).toBe(bastion.id);
    expect(codeOf(() => targets.save(base({ name: "x", jump: "nada" })))).toBe("bad_request");
    expect(codeOf(() => targets.save({ ...base(), id: bastion.id, jump: bastion.id }))).toBe(
      "bad_request",
    );
    // bastion → inner → bastion would be a loop.
    expect(codeOf(() => targets.save({ ...base(), id: bastion.id, jump: inner.id }))).toBe(
      "bad_request",
    );
    // A chain of two is fine.
    const deep = targets.save(base({ name: "deep", host: "10.0.1.1", jump: inner.id }));
    expect(deep.jump).toBe(inner.id);
    expect(codeOf(() => targets.remove(bastion.id, true))).toBe("invalid_state");
    expect(targets.get(bastion.id)).not.toBeNull();
    targets.remove(deep.id, true);
    targets.remove(inner.id, true);
    expect(codeOf(() => targets.remove(bastion.id, true))).toBe("ok");
  });

  test("remover pede confirmação e um id que não existe é not_found", () => {
    const { targets } = setup();
    const target = targets.save(base());
    expect(codeOf(() => targets.remove(target.id, false))).toBe("invalid_state");
    expect(targets.list()).toHaveLength(1);
    targets.remove(target.id, true);
    expect(targets.list()).toEqual([]);
    expect(codeOf(() => targets.remove(target.id, true))).toBe("not_found");
  });

  test("as tags são aparadas, sem repetição e com limite", () => {
    const { targets } = setup();
    const tags = (list: string[]) => targets.save(base({ tags: list })).tags;
    expect(tags([" prod ", "cliente X", "prod", ""])).toEqual(["prod", "cliente X"]);
    expect(codeOf(() => tags(["a,b"]))).toBe("bad_request");
    expect(codeOf(() => tags(["a\nb"]))).toBe("bad_request");
    expect(codeOf(() => tags(["x".repeat(41)]))).toBe("bad_request");
    expect(codeOf(() => tags(Array.from({ length: 21 }, (_, i) => `t${i}`)))).toBe("bad_request");
  });

  test("as opções são uma lista curta; ForwardAgent nasce desligado e ligar pede confirmação", () => {
    const { targets } = setup();
    const save = (extra: Partial<SshTargetInput>, id?: string) =>
      codeOf(() => targets.save({ ...base(), ...(id ? { id } : {}), ...extra }));
    const good = targets.save(
      base({
        options: {
          serverAliveInterval: 30,
          compression: true,
          localForward: ["8080:localhost:80", "127.0.0.1:5432:db.internal:5432"],
        },
      }),
    );
    expect(good.options).toEqual({
      serverAliveInterval: 30,
      compression: true,
      localForward: ["8080:localhost:80", "127.0.0.1:5432:db.internal:5432"],
    });
    expect(save({ options: { serverAliveInterval: 0 } })).toBe("bad_request");
    expect(save({ options: { serverAliveInterval: 4000 } })).toBe("bad_request");
    for (const forward of [
      "8080",
      "x:y",
      "8080:host name:80",
      "-oX=1",
      "8080:h:80 -oX=1",
      "8080:h:0",
    ]) {
      expect([forward, save({ options: { localForward: [forward] } })]).toEqual([
        forward,
        "bad_request",
      ]);
    }
    // ForwardAgent hands the remote host your agent: on only after an explicit yes.
    expect(save({ options: { forwardAgent: true } })).toBe("invalid_state");
    expect(save({ options: { forwardAgent: true }, confirm: false })).toBe("invalid_state");
    const on = targets.save({
      ...base({ name: "fa" }),
      options: { forwardAgent: true },
      confirm: true,
    });
    expect(on.options.forwardAgent).toBe(true);
    // Already on: saving the rest of the form does not ask again; turning it off never asks.
    expect(save({ name: "fa2", options: { forwardAgent: true } }, on.id)).toBe("ok");
    expect(save({ name: "fa3", options: { forwardAgent: false } }, on.id)).toBe("ok");
    expect(save({ name: "fa4", options: { forwardAgent: true } }, on.id)).toBe("invalid_state");
    expect(targets.save(base({ name: "padrão" })).options.forwardAgent).toBeUndefined();
  });

  test("trocar o host ou a porta esquece a chave do servidor; o resto da edição a mantém", () => {
    const { targets, store } = setup();
    const target = targets.save(base());
    const stored = JSON.stringify({ fingerprint: "SHA256:abc", keys: ["ssh-ed25519 AAAA"] });
    const pin = () =>
      store.db.query("UPDATE ssh_targets SET host_key = ? WHERE id = ?").run(stored, target.id);
    pin();
    expect(targets.get(target.id)?.hostKey).toBe("SHA256:abc");
    targets.save({ ...base({ name: "outro nome", tags: ["prod"] }), id: target.id });
    expect(targets.get(target.id)?.hostKey).toBe("SHA256:abc");
    targets.save({ ...base({ host: "outro.example.com" }), id: target.id });
    expect(targets.get(target.id)?.hostKey).toBeNull();
    pin();
    targets.save({ ...base({ host: "outro.example.com", port: 2222 }), id: target.id });
    expect(targets.get(target.id)?.hostKey).toBeNull();
  });

  test("nenhum segredo vai para a tabela: só as colunas da spec, e a senha nem entra", () => {
    const { targets, store } = setup();
    targets.save(base({ auth: "password", secretRef: "senha-da-vps" }));
    const columns = (
      store.db.query("PRAGMA table_info(ssh_targets)").all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(columns).toEqual([
      "id",
      "name",
      "host",
      "port",
      "user",
      "via_host",
      "auth",
      "secret_ref",
      "jump",
      "options",
      "tags",
      "host_key",
      "created_at",
      "updated_at",
    ]);
    const row = store.db.query("SELECT * FROM ssh_targets").get() as Record<string, unknown>;
    expect(row.secret_ref).toBe("senha-da-vps");
    expect(JSON.stringify(row)).not.toMatch(/hunter2/);
  });

  test("pelo protocolo: listar, salvar, remover com confirmação; campo desconhecido (uma senha) é recusado", async () => {
    const { targets, store } = setup();
    const { root } = workspace();
    const server = startServer({
      manager: newManager().manager,
      ssh: targets,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const codeOfCall = async (type: string, payload: unknown) =>
      ((await client.request(type, payload)).error as { code?: string } | undefined)?.code ?? "ok";
    expect(await client.data("ssh.list", {})).toEqual({ targets: [] });
    const saved = await client.data<{ id: string; port: number }>("ssh.save", {
      name: "vps",
      host: "vps.example.com",
      user: "deploy",
    });
    expect(saved?.port).toBe(22);
    expect(await client.data<{ targets: unknown[] }>("ssh.list", {})).toMatchObject({
      targets: [{ id: saved?.id, name: "vps" }],
    });
    // A password is never a field of a target.
    expect(
      await codeOfCall("ssh.save", {
        name: "x",
        host: "h.example.com",
        user: "u",
        password: "hunter2",
      }),
    ).toBe("bad_request");
    expect(JSON.stringify(store.db.query("SELECT * FROM ssh_targets").all())).not.toContain(
      "hunter2",
    );
    expect(
      await codeOfCall("ssh.save", {
        name: "f",
        host: "f",
        user: "u",
        options: { forwardAgent: true },
      }),
    ).toBe("invalid_state");
    expect(
      await codeOfCall("ssh.save", {
        name: "f",
        host: "f",
        user: "u",
        options: { forwardAgent: true },
        confirm: true,
      }),
    ).toBe("ok");
    expect(await codeOfCall("ssh.remove", { id: saved?.id })).toBe("bad_request");
    expect(await codeOfCall("ssh.remove", { id: saved?.id, confirm: false })).toBe("invalid_state");
    expect(await codeOfCall("ssh.remove", { id: saved?.id, confirm: true })).toBe("ok");
    expect(await codeOfCall("ssh.remove", { id: saved?.id, confirm: true })).toBe("not_found");
  });

  test("sem o cadastro configurado, os comandos ssh dizem que está desativado", async () => {
    const { root } = workspace();
    const server = startServer({
      manager: newManager().manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const ack = await client.request("ssh.list", {});
    expect((ack.error as { code?: string } | undefined)?.code).toBe("invalid_state");
  });
});
