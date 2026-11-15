import { afterEach, describe, expect, test } from "bun:test";
import type { FlightdeckError } from "../../src/kernel/errors.ts";
import type { Rule } from "../../src/vault/domain/rules.ts";
import { VaultRules } from "../../src/vault/rules-store.ts";
import { allow, echoDef, HOUR, NOW, runCleanups, setup } from "../support/rules-approval.ts";

afterEach(runCleanups);

describe("regras-aprovacao: a prévia", () => {
  test("preview dá o veredito de um uso hipotético sem registrar nem gastar nada", async () => {
    const t = setup();
    t.setRules([
      allow({
        id: "util",
        match: { requester: "claude", tags: ["staging"] },
        window: { days: ["mon", "tue", "wed", "thu", "fri"], from: "08:00", to: "18:00" },
        maxPerHour: 1,
      }),
    ]);
    const use = {
      secretId: "token",
      requester: "claude" as const,
      purpose: "action" as const,
      action: "deploy",
      tags: ["staging"],
    };
    expect(t.actions.preview(use)).toMatchObject({ decision: "allow", ruleId: "util" });
    expect(t.actions.preview({ ...use, at: NOW + 8 * HOUR })).toMatchObject({ decision: "deny" });
    expect(t.actions.preview({ ...use, requester: "automation" })).toMatchObject({
      decision: "deny",
      ruleId: null,
    });
    expect(t.actions.preview({ ...use, risk: "high" })).toMatchObject({
      decision: "ask",
      needsHold: true,
    });
    expect(t.actions.preview({ ...use, actionApproval: "always", tags: [] })).toMatchObject({
      decision: "ask",
      once: false,
    });
    expect(t.actions.decisions({})).toEqual([]);
    expect(t.requests()).toEqual([]);
  });
});

describe("regras-aprovacao: as regras de um segredo", () => {
  const ruleList: Rule[] = [{ id: "r1", match: { requester: "claude" }, decision: "ask" }];

  test("guarda as regras e as tags do segredo, troca tudo ao guardar de novo e devolve vazio para quem não tem", () => {
    const rules = new VaultRules();
    expect(rules.set("tok", ["Prod"], ruleList)).toBe(1);
    expect(rules.get("tok")).toEqual({ tags: ["prod"], rules: ruleList });
    expect(rules.rulesFor("tok")).toEqual(ruleList);
    expect(rules.tagsFor("tok")).toEqual(["prod"]);
    expect(rules.set("tok", [], [])).toBe(0);
    expect(rules.get("tok")).toEqual({ tags: [], rules: [] });
    expect(rules.get("outro")).toEqual({ tags: [], rules: [] });
    expect(rules.rulesFor("outro")).toEqual([]);
    expect(rules.tagsFor("outro")).toEqual([]);
  });

  test("regras fora do teto ou malformadas são recusadas inteiras, com o motivo, e as antigas ficam", () => {
    const rules = new VaultRules();
    rules.set("tok", [], ruleList);
    let error: FlightdeckError | undefined;
    try {
      rules.set("tok", [], [{ id: "x", decision: "allow", match: { purpose: "run_with_secret" } }]);
    } catch (e) {
      error = e as FlightdeckError;
    }
    expect(error?.code).toBe("bad_request");
    expect(error?.message).toContain("run_with_secret");
    expect(rules.rulesFor("tok")).toEqual(ruleList);
  });
});

describe("regras-aprovacao: as tags do uso", () => {
  test("as tags da ação e as do segredo juntam sem repetir, no frame e na decisão", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef({ tags: ["prod", "api"] }) });
    t.setRules([], ["prod", "pci"]);
    const running = t.run();
    const f = await t.frame();
    expect(f.tags).toEqual(["prod", "api", "pci"]);
    expect(f.needsHold).toBe(true);
    t.approveAndDeliver(f, { via: "app", heldMs: 2000 });
    await running;
    expect(
      t.actions.preview({
        secretId: "token",
        requester: "claude",
        purpose: "action",
        tags: ["api"],
      }),
    ).toMatchObject({ decision: "ask", needsHold: true });
  });
});
