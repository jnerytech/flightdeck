import { describe, expect, test } from "bun:test";
import type { PendingPermission, SessionSummary } from "@flightdeck/protocol";
import { trayStatus } from "../src/lib/tray.ts";

const pending = (n: number): PendingPermission[] =>
  Array.from({ length: n }, (_, i) => ({
    requestId: `r${i}`,
    toolName: "Bash",
    createdAt: "2026-10-28T00:00:00.000Z",
  }));

const session = (n: number) =>
  ({ pendingPermissions: pending(n) }) as Pick<SessionSummary, never> & {
    pendingPermissions: PendingPermission[];
  };

describe("badge-bandeja", () => {
  test("sem pedidos: contagem zero e dica neutra", () => {
    expect(trayStatus([])).toEqual({ count: 0, tooltip: "Flightdeck: nada esperando você" });
    expect(trayStatus([{ name: "pc", sessions: [session(0)] }])).toEqual({
      count: 0,
      tooltip: "Flightdeck: nada esperando você",
    });
  });

  test("um pedido usa singular e cita o host", () => {
    expect(trayStatus([{ name: "pc", sessions: [session(1), session(0)] }])).toEqual({
      count: 1,
      tooltip: "Flightdeck: 1 pedido esperando você (pc: 1)",
    });
  });

  test("soma todos os hosts, lista do maior para o menor e ignora hosts sem pedido", () => {
    expect(
      trayStatus([
        { name: "vps", sessions: [session(1)] },
        { name: "wsl", sessions: [] },
        { name: "pc", sessions: [session(2), session(1)] },
        { name: "pi", sessions: [session(1)] },
      ]),
    ).toEqual({ count: 5, tooltip: "Flightdeck: 5 pedidos esperando você (pc: 3, pi: 1, vps: 1)" });
  });
});
