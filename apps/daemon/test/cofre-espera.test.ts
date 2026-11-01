import { afterEach, describe, expect, test } from "bun:test";
import { Vault, type VaultDelivery } from "../src/vault/vault.ts";

const NOW = 1_800_000_000_000;
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function setup() {
  const now = { at: NOW };
  const vault = new Vault({ clock: () => now.at, log: () => {} });
  cleanups.push(() => vault.stop());
  return { vault, now };
}

function delivery(over: Partial<VaultDelivery> = {}): VaultDelivery {
  return {
    secretId: "s1",
    value: "VALOR-1",
    purpose: "action:deploy:r1",
    expiresAt: NOW + 30_000,
    requester: "claude",
    ...over,
  };
}

const failure = async (promise: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof promise === "function" ? promise() : promise);
    return "ok";
  } catch (error) {
    return `${(error as { code?: string }).code}: ${(error as Error).message}`;
  }
};

describe("cofre-espera", () => {
  test("take entrega o valor para o propósito certo e o descarta", async () => {
    const { vault } = setup();
    vault.deliver(delivery(), "127.0.0.1");
    expect(vault.take("s1", "action:deploy:r1")).toBe("VALOR-1");
    expect(vault.held()).toBe(0);
    expect(await failure(() => vault.take("s1", "action:deploy:r1"))).toContain("not_found");
  });

  test("take com outro propósito falha e não gasta o valor; vencido some", async () => {
    const { vault, now } = setup();
    vault.deliver(delivery(), "127.0.0.1");
    const error = await failure(() => vault.take("s1", "outro"));
    expect(error).toContain("invalid_state");
    expect(error).toContain("action:deploy:r1");
    expect(error).not.toContain("VALOR-1");
    expect(vault.held()).toBe(1);
    now.at += 31_000;
    expect(await failure(() => vault.take("s1", "action:deploy:r1"))).toContain("not_found");
  });

  test("waitFor devolve na hora o que já está guardado, e gasta", async () => {
    const { vault } = setup();
    vault.deliver(delivery(), "127.0.0.1");
    expect(await vault.waitFor("s1", "action:deploy:r1", 1000)).toBe("VALOR-1");
    expect(vault.held()).toBe(0);
  });

  test("waitFor espera a entrega com o propósito dele; outra entrega não o acorda", async () => {
    const { vault } = setup();
    let done = "";
    const waiting = vault.waitFor("s1", "action:deploy:r1", 2000).then((value) => {
      done = value;
    });
    vault.deliver(delivery({ purpose: "outro" }), "127.0.0.1");
    vault.deliver(delivery({ secretId: "s2" }), "127.0.0.1");
    await Bun.sleep(20);
    expect(done).toBe("");
    // The wrong deliveries stay held, untouched.
    expect(vault.held()).toBe(2);
    vault.deliver(delivery(), "127.0.0.1");
    await waiting;
    expect(done).toBe("VALOR-1");
    // The one it took is gone; the others are still there.
    expect(vault.held()).toBe(1);
  });

  test("waitFor estoura no prazo e a entrega de depois fica guardada, não perdida em espera", async () => {
    const { vault } = setup();
    const error = await failure(vault.waitFor("s1", "action:deploy:r1", 30));
    expect(error).toContain("invalid_state");
    expect(error).toContain("s1");
    vault.deliver(delivery(), "127.0.0.1");
    expect(vault.held()).toBe(1);
    expect(vault.take("s1", "action:deploy:r1")).toBe("VALOR-1");
  });

  test("o sinal cancela a espera e tira quem espera da fila; um sinal já cancelado falha na hora", async () => {
    const { vault } = setup();
    const controller = new AbortController();
    const waiting = failure(vault.waitFor("s1", "action:deploy:r1", 5000, controller.signal));
    controller.abort();
    const error = await waiting;
    expect(error).toContain("invalid_state");
    expect(error).toContain("cancelled");
    // Nobody is waiting any more: a delivery just stays held.
    vault.deliver(delivery(), "127.0.0.1");
    expect(vault.held()).toBe(1);
    const aborted = AbortSignal.abort();
    expect(await failure(vault.waitFor("s2", "p", 5000, aborted))).toContain("cancelled");
  });

  test("stop encerra quem espera, e o erro não leva valor", async () => {
    const { vault } = setup();
    const waiting = failure(vault.waitFor("s1", "action:deploy:r1", 5000));
    vault.stop();
    const error = await waiting;
    expect(error).toContain("invalid_state");
    expect(error).toContain("closed");
  });
});
