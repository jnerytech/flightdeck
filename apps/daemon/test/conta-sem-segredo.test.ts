import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AccountState } from "@flightdeck/protocol";
import { Account } from "../src/account/account.ts";
import { Quota } from "../src/quota/quota.ts";

const DIR = join(import.meta.dir, "../src/account");

function sources(): Array<{ file: string; text: string }> {
  return readdirSync(DIR, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts"))
    .map((file) => ({ file, text: readFileSync(join(DIR, file), "utf8") }));
}

/** What the account module must never touch: a credential file, a token variable, a claude.ai endpoint. */
const FORBIDDEN: Array<[string, RegExp]> = [
  ["a credentials file", /\.credentials/i],
  ["the OAuth token variable", /CLAUDE_CODE_OAUTH_TOKEN/],
  ["the API key variable", /ANTHROPIC_API_KEY/],
  ["the auth token variable", /ANTHROPIC_AUTH_TOKEN/],
  ["a claude.ai or Anthropic URL", /https?:\/\/[\w.-]*(claude\.ai|anthropic\.com)/i],
  ["the environment", /process\.env|Bun\.env/],
  ["a path under the home folder", /homedir|\.claude\b|userHome/],
  ["a read of a file", /readFile|readFileSync|Bun\.file|openSync/],
  ["the store", /from "\.\.\/store\//],
  ["a log", /console\.|\blog\(/],
];

describe("conta-sem-segredo: the account module touches no secret", () => {
  test("the module has sources to scan", () => {
    expect(
      sources()
        .map((s) => s.file)
        .sort(),
    ).toEqual(["account.ts", "readers.ts"]);
  });

  for (const [what, pattern] of FORBIDDEN) {
    test(`nothing under account/ mentions ${what}`, () => {
      const hits = sources()
        .filter(({ text }) => pattern.test(text))
        .map(({ file }) => file);
      expect(hits).toEqual([]);
    });
  }

  test("the state sent over the wire has only the declared fields and none that looks like a secret", async () => {
    const quota = new Quota({ pauseAt: null });
    const account = new Account({
      quota,
      readers: {
        status: async () => ({
          loggedIn: true,
          authMethod: "claude.ai",
          apiProvider: "firstParty",
          email: "demo@example.com",
          organization: "Demo Org",
          plan: "max",
        }),
        sdk: async () => ({
          info: {
            email: "demo@example.com",
            organization: "Demo Org",
            plan: "max",
            tokenSource: "claude.ai",
            apiKeySource: null,
            apiProvider: "firstParty",
          },
          usage: { plan: "max", available: true, windows: [] },
        }),
      },
    });
    const state = await account.readNow();
    quota.stop();
    expect(Object.keys(AccountState.parse(state)).sort()).toEqual([
      "error",
      "loginCommand",
      "name",
      "organization",
      "plan",
      "provider",
      "readAt",
      "source",
      "stale",
      "status",
      "windows",
    ]);
    // `tokenSource` names where a token comes from, not the token: it never leaves the daemon either.
    expect(JSON.stringify(state)).not.toMatch(/token|secret|password|cookie|credential/i);
  });
});
