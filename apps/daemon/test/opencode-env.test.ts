import { describe, expect, test } from "bun:test";
import {
  CREDENTIAL_READS,
  opencodeConfig,
  opencodeEnv,
  opencodeRules,
} from "../src/runtime/opencode-config.ts";

const RULES = [
  { action: "*", resource: "*", effect: "ask" },

  ...[
    "*/.env*",
    "*.env",
    "*/.ssh/*",
    "*/.aws/*",
    "*/.config/gh/*",
    "*/.claude/.credentials.json",
    "*/.claude.json",
    "*/.flightdeck/config.json",
    "*.pem",
    "*.key",
    "*/id_*",
  ].map((resource) => ({ action: "read", resource, effect: "ask" })),
  { action: "read", resource: "*.env.example", effect: "allow" },
  { action: "question", resource: "*", effect: "deny" },
  { action: "subagent", resource: "*", effect: "deny" },
];

describe("opencode-env", () => {
  test("the rules: everything asks (Flightdeck allows reads inside the folder by real path), question and subagent denied", () => {
    expect(CREDENTIAL_READS.length).toBe(11);
    expect(opencodeRules()).toEqual(RULES as ReturnType<typeof opencodeRules>);
  });

  test("the document is exactly Flightdeck's two agents, the built-ins disabled and the rules at the top too", () => {
    expect(opencodeConfig()).toEqual({
      default_agent: "flightdeck",
      permissions: RULES,
      agents: {
        flightdeck: { mode: "primary", description: "Flightdeck", permissions: RULES },
        "flightdeck-plan": {
          mode: "primary",
          description: "Flightdeck plan",
          permissions: [...RULES, { action: "edit", resource: "*", effect: "deny" }],
        },
        build: { disabled: true },
        plan: { disabled: true },
        explore: { disabled: true },
        general: { disabled: true },
      },
    });
  });

  test("extra agents from the global scope are disabled by id; ours and the built-ins are never listed twice", () => {
    const agents = (opencodeConfig(["reviewer", "team/qa", "build", "flightdeck"]).agents ??
      {}) as Record<string, unknown>;
    expect(agents.reviewer).toEqual({ disabled: true });
    expect(agents["team/qa"]).toEqual({ disabled: true });
    expect(agents.build).toEqual({ disabled: true });
    expect((agents.flightdeck as { description?: string } | undefined)?.description).toBe(
      "Flightdeck",
    );
    expect(Object.keys(agents).length).toBe(8);
  });

  test("the env drops the daemon's OPENCODE_* but the provider key, and adds project config off and the document", () => {
    const env = opencodeEnv(
      {
        PATH: "/bin",
        HOME: "/h",
        FLIGHTDECK_SESSION: "s1",
        OPENCODE_CONFIG: "/evil.json",
        OPENCODE_CONFIG_DIR: "/evil",
        OPENCODE_PASSWORD: "x",
        OPENCODE_DISABLE_PROJECT_CONFIG: "0",
        OPENCODE_CONFIG_CONTENT: "{}",
        OPENCODE_API_KEY: "zen-key",
      },
      '{"default_agent":"flightdeck"}',
    );
    expect(env).toEqual({
      PATH: "/bin",
      HOME: "/h",
      FLIGHTDECK_SESSION: "s1",
      OPENCODE_API_KEY: "zen-key",
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_CONFIG_CONTENT: '{"default_agent":"flightdeck"}',
    });
  });
});
