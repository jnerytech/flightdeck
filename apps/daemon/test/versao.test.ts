import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROTOCOL_VERSION } from "@flightdeck/protocol";
import { runCli } from "../src/main.ts";
import { DAEMON_VERSION } from "../src/server.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");
const json = (path: string) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

describe("versao", () => {
  test("protocolo, daemon, desktop e tauri.conf.json têm a mesma versão do produto, 0.11.0", () => {
    const protocol = json("packages/protocol/package.json").version;
    const daemon = json("apps/daemon/package.json").version;
    const desktop = json("apps/desktop/package.json").version;
    // tauri.conf.json takes it from the desktop's package.json.
    const tauri = json("apps/desktop/src-tauri/tauri.conf.json").version;
    expect(tauri).toBe("../package.json");
    expect([protocol, daemon, desktop]).toEqual(["0.11.0", "0.11.0", "0.11.0"]);
    expect(DAEMON_VERSION).toBe("0.11.0");
  });

  test("flightdeckd --version imprime a versão e o protocolo e sai com 0", async () => {
    const out: string[] = [];
    let code = null as number | null;
    const daemon = await runCli(["--version"], {
      env: {},
      log: { log: (m) => out.push(m), error: (m) => out.push(m) },
      exit: (c) => {
        code = c;
      },
      onSignal: () => {},
    });
    expect(daemon).toBeNull();
    expect(out).toEqual([`flightdeckd ${DAEMON_VERSION} (protocolo ${PROTOCOL_VERSION})`]);
    expect(code).toBe(0);
  });
});
