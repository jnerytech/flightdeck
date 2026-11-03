import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { COST_FIELDS, MONEY_WORDS, moneyFieldsIn } from "../lib/no-money.ts";

const ROOT = resolve(import.meta.dir, "../..");
const PROTOCOL = readFileSync(join(ROOT, "packages/protocol/src/index.ts"), "utf8");
const ROI_TYPES = ["RoiWeek", "RoiPeriod", "RoiProject", "RoiSummaryResult"] as const;

describe("roi-sem-dinheiro: no money reaches the daemon", () => {
  test("the scanner finds a field that says money and lets the agents' cost through", () => {
    const sample = [
      "export interface RoiPeriod {",
      "  costUsd: number;",
      "  fixCostUsd: number;",
      "  hourlyRate: number;",
      "  /** the billed amount */",
      "  billedUsd: number;",
      "  cards: number;",
      "}",
      "export interface Other {",
      "  price: number;",
      "}",
    ].join("\n");
    expect(moneyFieldsIn(sample, ["RoiPeriod"])).toEqual(["hourlyRate", "billedUsd"]);
    expect(moneyFieldsIn(sample, ["Other"])).toEqual(["price"]);
    expect(moneyFieldsIn(sample, ["Missing"])).toEqual([]);
    expect(COST_FIELDS.has("costUsd")).toBe(true);
    expect(MONEY_WORDS.test("rate")).toBe(true);
    expect(MONEY_WORDS.test("cards")).toBe(false);
  });

  test("the roll-up's types hold counts, tokens, hours and the agents' cost, and no money field", () => {
    expect(moneyFieldsIn(PROTOCOL, ROI_TYPES)).toEqual([]);
  });

  test("what this phase adds to a card and a project is hours, never an amount", () => {
    const card = /estimateHours: z\.number\(\)/.test(PROTOCOL);
    const project = /defaultHours: z\.number\(\)/.test(PROTOCOL);
    expect(card && project).toBe(true);
    const roiPayload =
      /cmd\(\s*"roi\.summary",[\s\S]*?\.strict\(\),\s*\)/.exec(PROTOCOL)?.[0] ?? "";
    expect(roiPayload).not.toBe("");
    expect(MONEY_WORDS.test(roiPayload)).toBe(false);
  });

  test("the daemon's roi code and its source never name a rate, a price, a billed amount or the clients store", () => {
    const roiDir = join(ROOT, "apps/daemon/src/roi");
    for (const file of readdirSync(roiDir)) {
      const text = readFileSync(join(roiDir, file), "utf8")
        .replace(
          /\bcostUsd\b|\bfixCostUsd\b|\boutsideCardsUsd\b|\bfix_cost_usd\b|\bcost_usd\b/g,
          "",
        )
        .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect({ file, hit: MONEY_WORDS.exec(text)?.[0] ?? null }).toEqual({ file, hit: null });
    }
    const daemonSrc = join(ROOT, "apps/daemon/src");
    const stack = [daemonSrc];
    const offenders: string[] = [];
    while (stack.length > 0) {
      const dir = stack.pop() as string;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) stack.push(path);
        else if (
          entry.name.endsWith(".ts") &&
          /flightdeck\.clients|hourlyRate|planPrice/.test(readFileSync(path, "utf8"))
        ) {
          offenders.push(path);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
