import { describe, expect, test } from "bun:test";
import type { AccountState } from "@flightdeck/protocol";
import type { DemoIds } from "../../demo-seed.ts";
import { narrowSizes } from "../../lib/shots/narrow.ts";
import { accountShots } from "../../lib/shots/table-account.ts";
import type { WireRule } from "../../lib/shots/wire.ts";

const IDS = {} as DemoIds;
const SHOTS = () => accountShots(IDS);
const named = (name: string) => SHOTS().find((shot) => shot.name === name);
const rule = (name: string, command: string): WireRule | undefined =>
  named(name)?.wire?.find((r) => r.command === command);
/** The account a print's `account.get` answers with. */
const answer = (name: string): AccountState | undefined => {
  const found = rule(name, "account.get");
  return found && "reply" in found ? (found.reply as AccountState) : undefined;
};

// #4351: the Claude account card had no print, so no axe check and no look at 390 px on any of its states.
describe("the Claude account card prints (#4351)", () => {
  test("the table prints signed in, signed out, API key, third party, unknown (with and without an error), loading and refreshing", () => {
    expect(SHOTS().map((shot) => shot.name)).toEqual([
      "host-conta-conectada",
      "host-conta-desconectada",
      "host-conta-chave-api",
      "host-conta-terceiros",
      "host-conta-desconhecida-erro",
      "host-conta-desconhecida",
      "host-conta-carregando",
      "host-conta-atualizando",
    ]);
  });

  test("each print opens the first demo host's page", () => {
    const routes = SHOTS().map((shot) => shot.route);
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) expect(route).toMatchObject({ name: "host", host: "demo-alfa" });
  });

  test("each print announces the account feature and keeps the host's own stream from replacing the card", () => {
    for (const shot of SHOTS()) {
      expect(shot.wire).toContainEqual({ command: "host.info", with: { features: ["account"] } });
      expect(shot.wire).toContainEqual({ command: "account.watch", stall: true });
    }
  });

  test("the status prints answer account.get with their own status", () => {
    expect(
      [
        "host-conta-conectada",
        "host-conta-desconectada",
        "host-conta-chave-api",
        "host-conta-terceiros",
        "host-conta-desconhecida-erro",
        "host-conta-desconhecida",
      ].map((name) => answer(name)?.status),
    ).toEqual(["signed_in", "signed_out", "api_key", "third_party", "unknown", "unknown"]);
  });

  test("the signed-in print has every window, one close to the limit and one rejected, each with a reset time", () => {
    const windows = answer("host-conta-conectada")?.windows ?? [];
    expect(windows.map((w) => w.window)).toEqual([
      "five_hour",
      "seven_day",
      "seven_day_opus",
      "seven_day_sonnet",
    ]);
    expect(windows.map((w) => w.status)).toContain("allowed_warning");
    expect(windows.map((w) => w.status)).toContain("rejected");
    expect(windows.every((w) => w.resetsAt?.startsWith("{in "))).toBe(true);
  });

  test("the third-party print names a provider and the unknown prints differ only by their error", () => {
    expect(answer("host-conta-terceiros")?.provider).toBe("bedrock");
    expect(answer("host-conta-desconhecida-erro")?.error).toBe("account_unavailable");
    expect(answer("host-conta-desconhecida")?.error).toBeNull();
    expect(answer("host-conta-desconhecida")?.readAt).not.toBeNull();
  });

  test("the loading print never answers, and the refreshing one answers the read but not the refresh", () => {
    expect(rule("host-conta-carregando", "account.get")).toEqual({
      command: "account.get",
      hold: true,
    });
    expect(rule("host-conta-atualizando", "account.refresh")).toEqual({
      command: "account.refresh",
      stall: true,
    });
    expect(answer("host-conta-atualizando")?.status).toBe("signed_in");
  });

  test("the card's states are re-measured narrow, in the dark prints", () => {
    expect(
      [
        "host-conta-conectada",
        "host-conta-desconectada",
        "host-conta-desconhecida-erro",
        "host-conta-atualizando",
      ].map((name) => narrowSizes("dark", name).length),
    ).toEqual([3, 3, 3, 3]);
  });
});
