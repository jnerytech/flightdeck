import { describe, expect, test } from "bun:test";
import { envInput, quoteArg, remoteCommand } from "../src/actions/ssh-command.ts";
import { whichOnPath } from "../src/which.ts";

const TRICKY = ["; rm -rf ~", "$(id)", "`id`", "a b", "it's", "--x", "", "*", "\\n", 'say "hi"'];

/** Runs the remote command the way the login shell on the other side would, if this host has sh. */
async function asRemote(command: string, stdin: string): Promise<string | null> {
  const sh = whichOnPath("sh");
  if (!sh) return null;
  const proc = Bun.spawn([sh, "-c", command], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(stdin);
  await proc.stdin.end();
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

describe("acoes-ssh: the remote command of an ssh action", () => {
  test("an argument is single-quoted, and a quote inside it is closed, escaped and reopened", () => {
    expect(quoteArg("a b")).toBe("'a b'");
    expect(quoteArg("it's")).toBe("'it'\\''s'");
    expect(quoteArg("")).toBe("''");
  });

  test("each argument reaches the other side as one literal word, whatever it holds", async () => {
    const command = remoteCommand(["printf", "[%s]\\n", ...TRICKY]);
    const out = await asRemote(command, envInput({}));
    // Without sh here (Windows), the quoting itself was checked above.
    if (out !== null) expect(out).toBe(TRICKY.map((a) => `[${a}]\n`).join(""));
  });

  test("the environment comes from stdin and is exported to the program, never on the command line", async () => {
    const env = { DEPLOY_TOKEN: "s3cr=t value; $(id)", OTHER: "x" };
    const command = remoteCommand(["sh", "-c", 'printf "%s|%s" "$DEPLOY_TOKEN" "$OTHER"']);
    expect(command).not.toContain("s3cr=t");
    expect(envInput(env)).toBe("DEPLOY_TOKEN=s3cr=t value; $(id)\nOTHER=x\n\n");
    const out = await asRemote(command, envInput(env));
    if (out !== null) expect(out).toBe("s3cr=t value; $(id)|x");
  });

  test("a variable name that is not a shell name, or a value with a line break or a NUL, is refused", () => {
    expect(() => envInput({ "BAD-NAME": "x" })).toThrow("invalid variable name");
    expect(() => envInput({ "1X": "x" })).toThrow("invalid variable name");
    expect(() => envInput({ KEY: "line1\nline2" })).toThrow("line break");
    expect(() => envInput({ KEY: "a\0b" })).toThrow("line break");
  });
});
