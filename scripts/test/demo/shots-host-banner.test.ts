import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { narrowSizes } from "../../lib/shots/narrow.ts";
import { hostShots } from "../../lib/shots/table-hosts.ts";

const IDS = {} as DemoIds;
const UNAUTHORIZED = [
  "host-nao-autorizado",
  "host-nao-autorizado-testando",
  "host-nao-autorizado-recusado",
];
const BANNERS = ["host-offline", "host-reconectando", "host-incompativel", ...UNAUTHORIZED];

describe("the host banner prints (#4413)", () => {
  test("the table holds the three unauthorized prints, each on the host page", () => {
    const shots = hostShots(IDS).filter((s) => UNAUTHORIZED.includes(s.name));
    expect(shots.map((s) => [s.name, s.route.name])).toEqual(UNAUTHORIZED.map((n) => [n, "host"]));
  });

  test("each opens the one demo host with a token its daemon refuses, not a healthy host", () => {
    const shots = hostShots(IDS).filter((s) => UNAUTHORIZED.includes(s.name));
    expect(shots.map((s) => s.query)).toEqual(
      UNAUTHORIZED.map(() => ({ hosts: "demo-alfa", refused: "demo-alfa" })),
    );
  });

  test("every banner state is re-measured at 1024, 640 and 390 in the dark prints", () => {
    expect(BANNERS.map((name) => narrowSizes("dark", name).map((size) => size.width))).toEqual(
      BANNERS.map(() => [1024, 640, 390]),
    );
  });
});
