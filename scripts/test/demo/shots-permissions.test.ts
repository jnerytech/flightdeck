import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { permissionShots } from "../../lib/shots/table-permissions.ts";
import { wireRewriter } from "../../lib/shots/wire.ts";

const IDS = { project: "p1", projectName: "flightdeck-web", waitingSession: "wt" } as DemoIds;
const named = (name: string) => permissionShots(IDS).find((shot) => shot.name === name);

describe("the permission prints (#4163)", () => {
  test("the table prints the approval card's states, the project's rules and the automatic approvals, in order", () => {
    expect(permissionShots(IDS).map((shot) => shot.name)).toEqual([
      "sessao-aprovacao-sempre",
      "sessao-aprovacao-negar",
      "sessao-aprovacao-risco-alto",
      "projeto-regras-vazio",
      "projeto-regras",
      "projeto-regras-falhou",
      "aprovacoes-automaticas-vazio",
      "aprovacoes-automaticas",
      "aprovacoes-automaticas-sem-resultado",
      "aprovacoes-automaticas-falhou",
    ]);
  });

  test("the editor and the deny form open on the session that waits for a permission, the high-risk card from Needs you", () => {
    const route = (name: string) => named(name)?.route.name;
    const session = (name: string) => {
      const r = named(name)?.route;
      return r?.name === "session" ? r.id : null;
    };
    expect([
      session("sessao-aprovacao-sempre"),
      session("sessao-aprovacao-negar"),
      route("sessao-aprovacao-risco-alto"),
    ]).toEqual(["wt", "wt", "needs-you"]);
  });

  test("the rules prints open the Projects screen, and each automatic approvals print opens its own page", () => {
    expect(
      ["projeto-regras-vazio", "projeto-regras", "projeto-regras-falhou"].map(
        (name) => named(name)?.route.name,
      ),
    ).toEqual(["projects", "projects", "projects"]);
    expect(
      [
        "aprovacoes-automaticas-vazio",
        "aprovacoes-automaticas",
        "aprovacoes-automaticas-sem-resultado",
        "aprovacoes-automaticas-falhou",
      ].map((name) => named(name)?.route.name),
    ).toEqual(["auto-approvals", "auto-approvals", "auto-approvals", "auto-approvals"]);
  });

  test("the empty prints show what the host answers; the other prints change the answer, the failed ones refuse it", () => {
    expect([
      named("projeto-regras-vazio")?.wire,
      named("aprovacoes-automaticas-vazio")?.wire,
    ]).toEqual([undefined, undefined]);
    expect(named("projeto-regras")?.wire).toEqual([
      { command: "rules.list", data: { rules: expect.arrayContaining([expect.any(String)]) } },
    ]);
    expect(named("projeto-regras-falhou")?.wire).toEqual([
      { command: "rules.list", refuse: expect.any(String) },
    ]);
    expect(named("aprovacoes-automaticas-falhou")?.wire).toEqual([
      { command: "autoapprove.list", refuse: expect.any(String) },
    ]);
  });

  test("the filled automatic approvals hold a decision of each kind and a suspended session, so every row and the Resume button show", () => {
    const wire = named("aprovacoes-automaticas")?.wire;
    const rule = wire?.find((r) => r.command === "autoapprove.list");
    const data = (rule && "data" in rule ? rule.data : null) as {
      decisions: Array<{ decision: string; by: string }>;
      suspended: unknown[];
    } | null;
    expect({
      kinds: new Set(data?.decisions.map((d) => `${d.decision}/${d.by}`)),
      suspended: data?.suspended.length,
    }).toEqual({
      kinds: new Set(["allow/rule", "allow/ai", "ask/ai"]),
      suspended: 1,
    });
    // The no-match print reads the same list, then filters it.
    expect(named("aprovacoes-automaticas-sem-resultado")?.wire).toEqual(wire);
  });

  test("the rewriter swaps the rules answer only when the host's own answer was ok", () => {
    const rewriter = wireRewriter(named("projeto-regras")?.wire ?? []);
    rewriter.fromApp(JSON.stringify({ id: "1", type: "rules.list" }));
    const out = JSON.parse(
      rewriter.fromHost(JSON.stringify({ id: "1", type: "ack", ok: true, data: { rules: [] } })),
    ) as { data: { rules: string[] } };
    expect(out.data.rules.length).toBeGreaterThan(0);
  });
});
