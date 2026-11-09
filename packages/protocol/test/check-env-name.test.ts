import { describe, expect, test } from "bun:test";
import { isCheckEnvName } from "../src/index.ts";

describe("check env names (#1361)", () => {
  test("a location of a toolchain is allowed", () => {
    for (const name of ["JAVA_HOME", "CARGO_HOME", "GOPATH", "GOROOT", "NVM_DIR", "BUN_INSTALL"]) {
      expect(isCheckEnvName(name)).toBe(true);
    }
    expect(isCheckEnvName("java_home")).toBe(true);
  });

  test("a name that is not shaped like a location is refused", () => {
    for (const name of ["PATH", "NODE_OPTIONS", "GIT_SSH_COMMAND", "JAVA_TOOL_OPTIONS", ""]) {
      expect(isCheckEnvName(name)).toBe(false);
    }
  });

  test("a location whose name says it is a secret is refused, in any case", () => {
    const words = [
      "TOKEN",
      "KEY",
      "SECRET",
      "PASSWORD",
      "PASSWD",
      "CREDENTIAL",
      "AUTH",
      "COOKIE",
      "SESSION",
      "JWT",
      "BEARER",
      "SAS",
      "SIGNATURE",
      "WEBHOOK",
      "DSN",
      "DATABASE_URL",
      "CONN",
      "PRIVATE",
      "CERT",
    ];
    for (const word of words) {
      expect(isCheckEnvName(`APP_${word}_HOME`)).toBe(false);
      expect(isCheckEnvName(`app_${word.toLowerCase()}_home`)).toBe(false);
    }
  });

  test("a location under Flightdeck's, git's, npm's or a loader's own prefix is refused", () => {
    const prefixes = [
      "ANTHROPIC",
      "CLAUDE",
      "OPENAI",
      "AWS",
      "AZURE",
      "GH",
      "GITHUB",
      "FLIGHTDECK",
      "GIT",
      "NPM",
      "LD",
      "DYLD",
      "XDG",
    ];
    for (const prefix of prefixes) {
      expect(isCheckEnvName(`${prefix}_DATA_HOME`)).toBe(false);
      expect(isCheckEnvName(`${prefix.toLowerCase()}_data_home`)).toBe(false);
    }
    // The prefix has to be the start of the name: a name that only contains it is a location.
    expect(isCheckEnvName("MY_GIT_HOME")).toBe(true);
  });
});
