import { describe, expect, test } from "bun:test";
import {
  DEMO_NEW_KEY,
  DEMO_OTHER_KEY,
  DEMO_THIS_KEY,
} from "../../../apps/desktop/src/demo/approval-keys.ts";
import type { DemoIds } from "../../demo-seed.ts";
import { devicesShots } from "../../lib/shots/table-devices.ts";

const IDS = {} as DemoIds;
const byName = (name: string) => devicesShots(IDS).find((shot) => shot.name === name);
const listed = (name: string) => {
  const rule = byName(name)?.wire?.find((r) => r.command === "approval.list");
  return rule && "data" in rule ? rule : null;
};

/** The ids of the devices the print's host lists. */
const keyIds = (name: string): string[] =>
  ((listed(name)?.data as { keys?: Array<{ keyId: string }> } | undefined)?.keys ?? []).map(
    (key) => key.keyId,
  );

describe("the approving-devices panel prints (#4154)", () => {
  test("the table prints the seven states, the first one twice: while it loads and when the read failed", () => {
    expect(devicesShots(IDS).map((shot) => shot.name)).toEqual([
      "aprovacao-carregando",
      "aprovacao-falha",
      "aprovacao-ativar",
      "aprovacao-lista",
      "aprovacao-perdida",
      "aprovacao-nao-checados",
      "aprovacao-oferta",
      "aprovacao-aguardando",
    ]);
  });

  test("every print opens the host's page with a key store the page can use: this device's key already made, or none", () => {
    const stores = devicesShots(IDS).map((shot) => [shot.route.name, shot.query?.approvalKeys]);
    expect(stores).toEqual([
      ["host", "empty"],
      ["host", "empty"],
      ["host", "empty"],
      ["host", "enrolled"],
      ["host", "enrolled"],
      ["host", "enrolled"],
      ["host", "enrolled"],
      ["host", "empty"],
    ]);
  });

  test("the loading print holds the list's answer and the failed one refuses it with a text", () => {
    expect(byName("aprovacao-carregando")?.wire).toEqual([
      { command: "approval.list", hold: true },
    ]);
    const failed = byName("aprovacao-falha")?.wire?.[0];
    expect(failed).toMatchObject({ command: "approval.list" });
    expect(failed && "refuse" in failed ? failed.refuse.length : 0).toBeGreaterThan(0);
  });

  test("the enroll form is the host that lists no device, and the list is this device's key and another's", () => {
    expect(listed("aprovacao-ativar")?.data).toEqual({ protectionOff: true, keys: [] });
    expect(keyIds("aprovacao-lista")).toEqual([DEMO_THIS_KEY.keyId, DEMO_OTHER_KEY.keyId]);
  });

  test("the devices of the list sit at documentation addresses (TEST-NET-1), not at a private network's (#4453)", () => {
    const data = listed("aprovacao-lista")?.data as
      | { keys: Array<{ address: string }> }
      | undefined;
    expect((data?.keys ?? []).map((key) => key.address)).toEqual(["192.0.2.20", "192.0.2.31"]);
  });

  test("the lost warning is a list that is read with a device and afterwards with none, after a revoke the page answers itself", () => {
    const rule = listed("aprovacao-perdida");
    expect(rule && "after" in rule ? rule.after : null).toEqual({ protectionOff: true, keys: [] });
    expect(byName("aprovacao-perdida")?.wire?.map((r) => r.command)).toEqual(
      expect.arrayContaining(["approval.revoke", "approval.challenge"]),
    );
  });

  test("the unchecked notice is a host that lacks the proof of some commands, trimmed from its host.info", () => {
    const rule = byName("aprovacao-nao-checados")?.wire?.find((r) => r.command === "host.info");
    expect(rule && "without" in rule ? Object.keys(rule.without) : []).toEqual(["features"]);
    expect(rule && "without" in rule ? (rule.without.features?.length ?? 0) : 0).toBeGreaterThan(0);
  });

  test("the offer and the waiting prints list the host with another device, and a device that is not listed (new) for the waiting one", () => {
    for (const name of ["aprovacao-oferta", "aprovacao-aguardando"]) {
      expect(keyIds(name)).toContain(DEMO_OTHER_KEY.keyId);
    }
    expect(keyIds("aprovacao-aguardando")).not.toContain(DEMO_NEW_KEY.keyId);
  });

  test("every replied command keeps its reply when the rules travel into the page as JSON", () => {
    const rules = devicesShots(IDS).flatMap((shot) => shot.wire ?? []);
    const travelled = JSON.parse(JSON.stringify(rules)) as Array<Record<string, unknown>>;
    expect(
      travelled.filter((rule, i) => "reply" in (rules[i] ?? {}) && !("reply" in rule)),
    ).toEqual([]);
  });

  test("a print that drives the panel has a step to prepare it", () => {
    expect(
      devicesShots(IDS)
        .filter((shot) => shot.prepare === undefined)
        .map((shot) => shot.name),
    ).toEqual([]);
  });
});
