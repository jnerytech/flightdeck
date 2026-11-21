import { describe, expect, test } from "bun:test";
import type { CostsSummary } from "@flightdeck/protocol";
import { originLabel, originOptions, originRows } from "../../src/features/costs/domain/origins.ts";
import { translator } from "../../src/i18n/index.ts";

/**
 * Issue #3612: the Origin filter and the "By origin" rows showed the daemon's ids (terminal, app,
 * card, workflow, subagent), so pt-BR read English. Each origin has a name in each language; the
 * option's value stays the id the daemon filters on.
 */
const NAMES = {
  en: {
    terminal: "Terminal",
    app: "App",
    card: "Card",
    workflow: "Workflow",
    subagent: "Subagent",
    "auto-approve": "Auto-approve",
    assistant: "Assistant",
  },
  "pt-BR": {
    terminal: "Terminal",
    app: "App",
    card: "Card",
    workflow: "Workflow",
    subagent: "Subagente",
    "auto-approve": "Aprovação automática",
    assistant: "Assistente",
  },
} as const;

describe.each(["en", "pt-BR"] as const)(
  "costs-origins (%s): an origin is named, never an id",
  (lang) => {
    const t = translator(lang);

    test("every origin the daemon reports has a name in this language", () => {
      for (const [id, name] of Object.entries(NAMES[lang])) expect(originLabel(id, t)).toBe(name);
    });

    test("an origin the dictionary does not know shows its id, never an empty label", () => {
      expect(originLabel("future-origin", t)).toBe("future-origin");
      // A name that Object.prototype owns is no origin either.
      expect(originLabel("constructor", t)).toBe("constructor");
      expect(originLabel("__proto__", t)).toBe("__proto__");
    });

    test("the filter lists the five origins with their names and keeps the id as the value", () => {
      const names = NAMES[lang];
      expect(originOptions(t)).toEqual([
        { value: "terminal", label: names.terminal },
        { value: "app", label: names.app },
        { value: "card", label: names.card },
        { value: "workflow", label: names.workflow },
        { value: "subagent", label: names.subagent },
      ]);
    });

    test("the By origin rows carry the names and the costs, in the order given", () => {
      const rows = originRows(
        [
          { origin: "subagent", costUsd: 3, tokens: 30 },
          { origin: "terminal", costUsd: 1, tokens: 10 },
        ] as CostsSummary["byOrigin"],
        t,
      );
      expect(rows).toEqual([
        { label: NAMES[lang].subagent, costUsd: 3 },
        { label: NAMES[lang].terminal, costUsd: 1 },
      ]);
    });
  },
);
