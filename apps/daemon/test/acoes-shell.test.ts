import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { shellLine } from "../src/actions/shell.ts";

describe("acoes-shell", () => {
  test("no Linux e no macOS a linha vai inteira para o sh -c, sem escrever nada", async () => {
    for (const platform of ["linux", "darwin"] as const) {
      const line = await shellLine(`echo "$A" | wc -c`, platform);
      expect(line.argv).toEqual(["sh", "-c", `echo "$A" | wc -c`]);
      await line.cleanup();
    }
  });

  test("no Windows a linha vai para um .cmd temporário, porque o cmd /c não recebe aspas pelo argv; cleanup apaga", async () => {
    const command = `bun -e "console.log(process.env.X)"\r\necho %Y%`;
    const line = await shellLine(command, "win32");
    expect(line.argv.slice(0, 3)).toEqual(["cmd", "/d", "/c"]);
    const file = line.argv[3] as string;
    expect(file).toMatch(/cmd\.cmd$/);
    expect(readFileSync(file, "utf8")).toBe(`@echo off\r\n${command}\r\n`);
    await line.cleanup();
    expect(existsSync(file)).toBe(false);
    // A second cleanup is harmless.
    await line.cleanup();
  });
});
