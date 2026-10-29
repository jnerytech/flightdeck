import { describe, expect, test } from "bun:test";
import { assertNoNetwork, installNetworkGuard } from "./network-guard.ts";

/** A target whose fetch only says which URL it got. */
function target() {
  const seen: string[] = [];
  const fetch = async (input: string | URL | Request) => {
    seen.push(String(input instanceof Request ? input.url : input));
    return new Response("ok");
  };
  return { holder: { fetch } as { fetch: typeof globalThis.fetch }, seen };
}

describe("trava-rede", () => {
  test("fetch para fora de 127.0.0.1 ou localhost é recusado e registrado; local passa", async () => {
    const { holder, seen } = target();
    const guard = installNetworkGuard(holder);
    const refused = await holder.fetch("https://github.com/jnerytech/flightdeck").then(
      () => "passou",
      (error: Error) => error.message,
    );
    expect(refused).toBe("trava de rede: acesso a github.com recusado nos testes");
    await holder.fetch("http://127.0.0.1:7420/health");
    await holder.fetch(new URL("http://localhost:1/x"));
    await holder.fetch(new Request("http://[::1]:2/y"));
    expect(seen).toEqual([
      "http://127.0.0.1:7420/health",
      "http://localhost:1/x",
      "http://[::1]:2/y",
    ]);
    expect(guard.attempts).toEqual(["https://github.com/jnerytech/flightdeck"]);
    expect(() => assertNoNetwork(guard)).toThrow("acesso à rede nos testes: https://github.com");
  });

  test("sem tentativas, a trava não reclama", () => {
    const { holder } = target();
    expect(() => assertNoNetwork(installNetworkGuard(holder))).not.toThrow();
  });

  test("o preload liga a trava para a suíte inteira", async () => {
    const refused = await fetch("https://github.com/").then(
      () => "passou",
      (error: Error) => error.message,
    );
    expect(refused).toStartWith("trava de rede");
  });
});
