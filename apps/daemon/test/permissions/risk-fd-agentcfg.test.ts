import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "writes a CLAUDE.md, an agent or a skill, which every later session of the project reads as its own instructions, without the person reading it in the app; a typed --confirm or --expected-hash is not the person (flightdeckd agentcfg write)";

describe("risk rules: a session writing agent configuration from its shell (#3617)", () => {
  test("agentcfg write is high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        [
          "fd agentcfg write api --kind claudemd --path CLAUDE.md --file next.md --new --confirm",
          REASON,
        ],
        ["flightdeckd agentcfg write api --kind agent --path .claude/agents/x.md - --new", REASON],
        ["fd --json agentcfg write api --kind skill --path .claude/skills/x/SKILL.md", REASON],
        ["flightdeckd --config /x/y.json agentcfg write api --kind agent", REASON],
        ["bun run apps/daemon/src/bin.ts agentcfg write api --kind agent", REASON],
        ["FLIGHTDECK_X=1 fd agentcfg write api --kind claudemd", REASON],
        ['fd agentcfg "write" api --kind claudemd', REASON],
        ["fd agentcfg read api --kind claudemd --path CLAUDE.md && fd agentcfg write api", REASON],
        ['bash -c "fd agentcfg write api --kind agent --path .claude/agents/x.md"', REASON],
        ["bunx flightdeckd agentcfg write api --kind agent", REASON],
      ]),
    ).toEqual([]);
  });

  test("agentcfg list and read stay ordinary shell commands, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd agentcfg list api --kind agent",
        "fd agentcfg read api --kind claudemd --path CLAUDE.md",
        "fd --json agentcfg read api --kind skill --path .claude/skills/x/SKILL.md",
        "fd agentcfg --help",
        "fd card list --project write",
        "echo agentcfg write",
        "git write agentcfg",
        "ls agentcfg/write",
      ]),
    ).toEqual([]);
  });
});
