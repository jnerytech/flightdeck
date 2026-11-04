import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tauriPlatform } from "../src/platform/tauri/index.ts";

describe("abrir-resultado-tauri: opening a result goes through the host-checked command", () => {
  test("Given the desktop shell, When a file is opened or shown, Then the app asks open_result, which checks the path", async () => {
    const invokes: Array<[string, unknown]> = [];
    const call = (async (cmd: string, args?: unknown) => {
      invokes.push([cmd, args]);
    }) as never;
    const platform = tauriPlatform({} as never, call);
    await platform.openPath?.("/work/Reports/a.docx");
    await platform.revealPath?.("/work/Reports/a.docx");
    expect(invokes).toEqual([
      ["open_result", { path: "/work/Reports/a.docx", reveal: false }],
      ["open_result", { path: "/work/Reports/a.docx", reveal: true }],
    ]);
  });
});

describe("abrir-resultado-tauri: what the webview may ask of the opener plugin", () => {
  const capability = JSON.parse(
    readFileSync(join(import.meta.dir, "../src-tauri/capabilities/default.json"), "utf8"),
  ) as { permissions: Array<string | { identifier: string }> };
  const identifiers = capability.permissions.map((p) => (typeof p === "string" ? p : p.identifier));

  test("Given the capability, Then the webview can open links but not paths, and cannot reveal a file", () => {
    expect(identifiers).toContain("opener:allow-open-url");
    expect(identifiers).toContain("opener:allow-default-urls");
    for (const refused of [
      "opener:default",
      "opener:allow-open-path",
      "opener:allow-reveal-item-in-dir",
    ]) {
      expect(identifiers).not.toContain(refused);
    }
  });

  test("Given the Rust shell, Then open_result is a command, with the checks that keep a result a document", () => {
    const source = readFileSync(join(import.meta.dir, "../src-tauri/src/lib.rs"), "utf8");
    expect(source).toContain("async fn open_result(");
    expect(source).toMatch(/open_result,?\s*\n/);
    for (const check of ["symlink_metadata", "canonicalize", "OPENABLE", "spawn_blocking_result"]) {
      expect(source).toContain(check);
    }
    // No script, shortcut or program is in the list of what opens.
    const list = /const OPENABLE: &\[&str\] = &\[([^\]]*)\]/.exec(source)?.[1] ?? "";
    for (const kind of ["exe", "bat", "cmd", "lnk", "url", "sh", "ps1", "html", "js", "docm"]) {
      expect(list).not.toMatch(new RegExp(`"${kind}"`));
    }
    // Pages that run script in a browser, and data some systems open in one.
    for (const kind of ["svg", "json"]) {
      expect(list).not.toMatch(new RegExp(`"${kind}"`));
    }
    // explorer.exe cannot open the \\?\ form canonicalize gives.
    expect(source).toContain("dunce::simplified");
  });
});
