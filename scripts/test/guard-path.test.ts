import { describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { guardPath } from "./guard-path.ts";
import { realTempDir } from "./temp-dir.ts";

function executable(dir: string, name: string): void {
  writeFileSync(join(dir, name), "#!/bin/sh\nexit 0\n");
  chmodSync(join(dir, name), 0o755);
}

describe("guard-path", () => {
  test.skipIf(process.platform === "win32")(
    "a pasta com o CLI guardado sai do PATH, mas o resto dela continua achável (gh mora junto do git em /usr/bin)",
    () => {
      const usrBin = realTempDir("fd-usr-bin-");
      for (const name of ["gh", "git", "sh"]) executable(usrBin, name);
      const other = realTempDir("fd-other-");
      executable(other, "bun");
      const sentinels = realTempDir("fd-sentinels-");
      executable(sentinels, "gh");
      const path = guardPath([usrBin, other].join(delimiter), ["gh"], sentinels);
      expect(Bun.which("gh", { PATH: path })).toBe(join(sentinels, "gh"));
      expect(Bun.which("git", { PATH: path })).not.toBeNull();
      expect(Bun.which("sh", { PATH: path })).not.toBeNull();
      expect(Bun.which("bun", { PATH: path })).toBe(join(other, "bun"));
      // Without the sentinels in front, the real one is still out of reach.
      const rest = path.split(delimiter).slice(1).join(delimiter);
      expect(Bun.which("gh", { PATH: rest })).toBeNull();
      expect(path.split(delimiter)).not.toContain(usrBin);
    },
  );

  test("pastas sem CLI guardado ficam como estão, depois das sentinelas", () => {
    const clean = realTempDir("fd-clean-");
    executable(clean, "git");
    const sentinels = realTempDir("fd-sentinels-");
    expect(guardPath(["", clean].join(delimiter), ["gh"], sentinels)).toBe(
      [sentinels, clean].join(delimiter),
    );
  });
});
