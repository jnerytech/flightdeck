import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { activityShots } from "../../lib/shots/table-activity.ts";

const SHOTS = () => activityShots({} as DemoIds);
const named = (name: string) => SHOTS().find((shot) => shot.name === name);

describe("the Activity board prints (#4244)", () => {
  test("the table prints the request, the high-risk request, idle on, filters that match nothing, no host and a refused answer", () => {
    expect(SHOTS().map((shot) => shot.name)).toEqual([
      "atividade-pedido",
      "atividade-alto-risco",
      "atividade-ociosas",
      "atividade-filtro-vazio",
      "atividade-sem-host",
      "atividade-resposta-falhou",
    ]);
  });

  test("every print opens the Activity screen", () => {
    expect(SHOTS().map((shot) => shot.route.name)).toEqual(Array(6).fill("activity"));
  });

  test("the no-host print starts the demo with no host, and no other print changes the address", () => {
    expect(named("atividade-sem-host")?.query).toEqual({ hosts: "none" });
    expect(SHOTS().filter((shot) => shot.query !== undefined)).toHaveLength(1);
  });

  test("the refused answer print makes the host refuse the answer to a request, and no other print touches the wire", () => {
    expect(named("atividade-resposta-falhou")?.wire?.map((rule) => rule.command)).toEqual([
      "permission.respond",
    ]);
    expect(named("atividade-resposta-falhou")?.wire?.some((rule) => "reject" in rule)).toBe(true);
    expect(SHOTS().filter((shot) => shot.wire !== undefined)).toHaveLength(1);
  });
});
