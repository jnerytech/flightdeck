import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { NARROW_SHOTS } from "../../lib/shots/narrow.ts";
import { quotaShots } from "../../lib/shots/table-quota.ts";

const NAMES = [
  "cota-cartao-quente",
  "cota-cartao-trava-leitura",
  "cota-cartao-sem-leitura",
  "cota-cartao-chave-api",
  "cota-cartao-conta-compartilhada",
  "cota-cartao-projecao",
  "cota-cartao-obsoleta",
];
const shots = () => quotaShots({} as DemoIds);
const named = (name: string) => shots().find((shot) => shot.name === name);
/** The data the print gives a command the host would answer. */
const answer = (name: string, command: string): unknown => {
  const rule = named(name)?.wire?.find((r) => r.command === command);
  return rule && "data" in rule ? rule.data : undefined;
};

// #4308: the Quota card's states had no print, so no axe check and no review of them.
describe("the Quota card prints (#4308)", () => {
  test("the table prints the hot card, the read-only guard, no reading, an API key, a shared account, the projection and a stale reading", () => {
    expect(shots().map((shot) => shot.name)).toEqual(NAMES);
  });

  test("each opens the hub, where the card is, and sends nothing to a host", () => {
    for (const name of NAMES) {
      expect(named(name)?.route).toEqual({ name: "hub" });
      // The streams that would overwrite the faked answer are answered in the page.
      expect(named(name)?.wire?.map((r) => r.command)).toContain("quota.watch");
    }
  });

  test("the card with a guard, the read-only guard and the shared card are measured at 390 px, where the guard row and its buttons must not overflow", () => {
    for (const name of [
      "cota-cartao-quente",
      "cota-cartao-trava-leitura",
      "cota-cartao-conta-compartilhada",
    ]) {
      expect(NARROW_SHOTS).toContain(name);
    }
  });

  test("the hot card has a window over the guard; the card with no reading has no window", () => {
    const hot = answer("cota-cartao-quente", "quota.get") as {
      windows: { utilization: number }[];
      pauseAt: number;
    };
    expect(hot.windows.some((w) => w.utilization >= hot.pauseAt)).toBe(true);
    expect(
      (answer("cota-cartao-sem-leitura", "quota.get") as { windows: unknown[] }).windows,
    ).toEqual([]);
  });

  test("the read-only guard takes the host's quotaPause feature away; the stale card says its last read failed; the API key card says the host has no plan", () => {
    const without = named("cota-cartao-trava-leitura")?.wire?.find(
      (r) => r.command === "host.info",
    );
    expect(without && "without" in without ? without.without : null).toEqual({
      features: ["quotaPause"],
    });
    expect((answer("cota-cartao-obsoleta", "account.get") as { stale: boolean }).stale).toBe(true);
    expect((answer("cota-cartao-chave-api", "account.get") as { status: string }).status).toBe(
      "api_key",
    );
  });

  test("the shared-account card gives every host the same signed-in account, and the projection one with an exhaustion time", () => {
    const account = answer("cota-cartao-conta-compartilhada", "account.get") as {
      status: string;
      name: string | null;
    };
    expect([account.status, account.name !== null]).toEqual(["signed_in", true]);
    const history = answer("cota-cartao-projecao", "quota.history") as {
      projection: { exhaustsAt: string | null };
    };
    expect(history.projection.exhaustsAt).not.toBeNull();
  });
});
