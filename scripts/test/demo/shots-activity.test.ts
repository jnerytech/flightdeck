import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { activityShots } from "../../lib/shots/table-activity.ts";

const SHOTS = () => activityShots({} as DemoIds);
const named = (name: string) => SHOTS().find((shot) => shot.name === name);

describe("the Activity board prints (#4244)", () => {
  test("the table prints the request, the high-risk request, idle on, filters that match nothing and a refused answer", () => {
    expect(SHOTS().map((shot) => shot.name)).toEqual([
      "atividade-pedido",
      "atividade-alto-risco",
      "atividade-ociosas",
      "atividade-filtro-vazio",
      "atividade-resposta-falhou",
    ]);
  });

  test("every print opens the Activity screen", () => {
    expect(SHOTS().map((shot) => shot.route.name)).toEqual(Array(5).fill("activity"));
  });

  test("no print changes the address: with no host every screen is Add host", () => {
    expect(SHOTS().filter((shot) => shot.query !== undefined)).toHaveLength(0);
  });

  test("the refused answer print makes the host refuse the answer to a request, and no other print touches the wire", () => {
    expect(named("atividade-resposta-falhou")?.wire?.map((rule) => rule.command)).toEqual([
      "permission.respond",
    ]);
    expect(named("atividade-resposta-falhou")?.wire?.some((rule) => "reject" in rule)).toBe(true);
    expect(SHOTS().filter((shot) => shot.wire !== undefined)).toHaveLength(1);
  });
});
