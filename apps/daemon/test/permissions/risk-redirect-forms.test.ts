import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { RiskClassifier } from "../../src/permissions/domain/risk.ts";

const CWD = resolve("/trabalho/proj");
const risk = new RiskClassifier({ allowedRoots: [], home: resolve("/casa/u") });
const OUT = "redirecionamento para fora do cwd";

/** Whether the shell command is held for a redirect that leaves the cwd. */
const leaves = (command: string) => {
  const got = risk.classify("Bash", { command }, CWD);
  return got.level === "high" && got.reason === OUT;
};

/**
 * Every written form of a redirect to a file, one at a time: the scanner reads each the same way
 * whatever its first characters are, and judges the target word it ends with (#2496, #2498).
 */
const FORMS = [">", ">>", "&>", "&>>", "2>", "1>>", "3>", ">|", "<>", ">&"];

describe("risk redirect forms: each written form of a redirect is judged by its target", () => {
  test("a target outside the cwd is held for every form, with or without a space", () => {
    const held = FORMS.flatMap((form) => [`echo x ${form}/tmp/f`, `echo x ${form} /tmp/f`]).filter(
      (command) => !leaves(command),
    );
    expect(held).toEqual([]);
  });

  test("a target inside the cwd is let through for every form", () => {
    const wrongly = FORMS.flatMap((form) => [
      `echo x ${form}out.txt`,
      `echo x ${form} out.txt`,
    ]).filter(leaves);
    expect(wrongly).toEqual([]);
  });

  test("a copy or a close of a descriptor is not a file", () => {
    const wrongly = [
      "ls 2>&1",
      "ls >&2",
      "ls 1>&2",
      "ls >&-",
      "ls 2>&-",
      "ls >&1-",
      "ls 2>&3-",
    ].filter(leaves);
    expect(wrongly).toEqual([]);
  });

  test("a word that only looks like a descriptor after >& is a file, and is judged as one", () => {
    expect([leaves("ls >&/tmp/f"), leaves("ls >&out.txt"), leaves("ls >&2x")]).toEqual([
      true,
      false,
      false,
    ]);
  });

  test("a second redirect glued to the first still counts", () => {
    expect([leaves("echo x >out.txt>/tmp/f"), leaves("echo x >a>b")]).toEqual([true, false]);
  });

  test("an escaped > is part of the target, and a real redirect after it counts", () => {
    expect([
      leaves("echo x >a\\>b"),
      leaves("echo x >a\\>/etc/y"),
      leaves("echo x >a\\>>/etc/y"),
    ]).toEqual([false, false, true]);
  });

  test("a > after a backslash is still read as a redirect, which holds more, never less", () => {
    expect(leaves("echo x \\>/tmp/f")).toBe(true);
  });

  test("a target of quoted and bare parts glued together is one word", () => {
    expect([
      leaves('echo x >"a b"/c.txt'),
      leaves("echo x >'/tmp'/f"),
      leaves('echo x >"out"/../../f'),
      leaves("echo x >a\\ b.txt"),
    ]).toEqual([false, true, true, false]);
  });

  test("a quote around a shell operator is never a plain target name", () => {
    expect([leaves('echo ">" ; echo x >/tmp/f'), leaves(`echo '>' x > out.txt`)]).toEqual([
      true,
      false,
    ]);
  });
});
