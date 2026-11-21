import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";
import { tempDir } from "../support/helpers.ts";

setDefaultTimeout(20_000);

const folders: string[] = [];
afterEach(async () => {
  await stopAll();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const HASH_A = "a".repeat(64);
const HASH_NEW = "c".repeat(64);
const TEXT = "const a = 2;\r\n\tlet b = 3;\n";

const OPEN: Handlers = {
  "file.write": () => ({ path: "src/a.ts", hash: HASH_NEW, size: 25 }),
};

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

/** The next version of a file on disk, as a person keeps it. */
function textFile(text: string): string {
  const folder = tempDir("file-write-cli-");
  folders.push(folder);
  const file = join(folder, "next.ts");
  writeFileSync(file, text);
  return file;
}

const stdin = (text: string) => ({ stdin: new Response(text).body as ReadableStream<Uint8Array> });

const write = (...rest: string[]) => ["file", "write", "card:c1", "src/a.ts", ...rest];

describe("flightdeckd file write (issue #3624)", () => {
  test("the file's text goes to the daemon byte for byte, with the hash the person repeats", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      write("--file", textFile(TEXT), "--hash", HASH_A, "--confirm"),
      daemon.port,
    );
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [`wrote src/a.ts  25 bytes  hash: ${HASH_NEW}`],
      err: [],
    });
    expect(callsOf(daemon, "file.write")).toEqual([
      { target: "card:c1", path: "src/a.ts", text: TEXT, expectedHash: HASH_A },
    ]);
  });

  test("`--file -` reads the text from standard input, and --json prints the path, hash and size", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      write("--file", "-", "--hash", HASH_A, "--confirm", "--json"),
      daemon.port,
      undefined,
      stdin(TEXT),
    );
    expect(run.code).toBe(0);
    expect(JSON.parse(run.out.join("\n"))).toEqual({
      path: "src/a.ts",
      hash: HASH_NEW,
      size: 25,
    });
    expect(callsOf(daemon, "file.write")).toEqual([
      { target: "card:c1", path: "src/a.ts", text: TEXT, expectedHash: HASH_A },
    ]);
  });

  test("a file that changed since it was read is the daemon's refusal: exit 1, and no word of an unknown outcome", async () => {
    const daemon = fakeDaemon({
      "file.write": () => ({
        error: { code: "file_conflict", message: "src/a.ts changed since it was opened" },
      }),
    });
    const run = await flightdeckd(
      write("--file", textFile(TEXT), "--hash", HASH_A, "--confirm"),
      daemon.port,
    );
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("src/a.ts changed since it was opened");
    expect(run.err.join("\n")).not.toContain("may or may not");
  });

  test("a connection that closes after the write was sent says the file may or may not have changed", async () => {
    const daemon = fakeDaemon({ "file.write": () => CLOSE });
    const run = await flightdeckd(
      write("--file", textFile(TEXT), "--hash", HASH_A, "--confirm"),
      daemon.port,
    );
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("may or may not have changed");
  });

  test("without --confirm, the hash or the text's file, or with a hash that is not a sha256, nothing is sent", async () => {
    const daemon = fakeDaemon(OPEN);
    const file = textFile(TEXT);
    const runs = await Promise.all([
      flightdeckd(write("--file", file, "--hash", HASH_A), daemon.port),
      flightdeckd(write("--file", file, "--confirm"), daemon.port),
      flightdeckd(write("--hash", HASH_A, "--confirm"), daemon.port),
      flightdeckd(write("--file", file, "--hash", "9f86d0a1b2c3", "--confirm"), daemon.port),
    ]);
    expect(runs.map((r) => r.code)).toEqual([1, 1, 1, 1]);
    expect(runs.map((r) => r.err.join("\n"))).toEqual([
      expect.stringContaining("--confirm"),
      expect.stringContaining("--hash"),
      expect.stringContaining("--file"),
      expect.stringContaining("64"),
    ]);
    expect(callsOf(daemon, "file.write")).toEqual([]);
  });

  test("a text file that cannot be read is refused with exit 1 and nothing is sent", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      write("--file", "/nonexistent/next.ts", "--hash", HASH_A, "--confirm"),
      daemon.port,
    );
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("/nonexistent/next.ts");
    expect(callsOf(daemon, "file.write")).toEqual([]);
  });

  test("a text file over 1 MB, or one that is not a regular file, is refused before the daemon is asked", async () => {
    const daemon = fakeDaemon(OPEN);
    const big = textFile("x".repeat(1024 * 1024 + 1));
    const runs = await Promise.all([
      flightdeckd(write("--file", big, "--hash", HASH_A, "--confirm"), daemon.port),
      flightdeckd(write("--file", "/dev/null", "--hash", HASH_A, "--confirm"), daemon.port),
    ]);
    expect(runs.map((r) => r.code)).toEqual([1, 1]);
    expect(runs.map((r) => r.err.join("\n"))).toEqual([
      expect.stringContaining("over 1 MB"),
      expect.stringContaining("not a regular file"),
    ]);
    expect(callsOf(daemon, "file.write")).toEqual([]);
  });

  test("standard input over 1 MB is refused before the daemon is asked, and a missing file says why", async () => {
    const daemon = fakeDaemon(OPEN);
    const [big, missing] = await Promise.all([
      flightdeckd(
        write("--file", "-", "--hash", HASH_A, "--confirm"),
        daemon.port,
        undefined,
        stdin("x".repeat(1024 * 1024 + 1)),
      ),
      flightdeckd(
        write("--file", "/nonexistent/next.ts", "--hash", HASH_A, "--confirm"),
        daemon.port,
      ),
    ]);
    expect(big.code).toBe(1);
    expect(big.err.join("\n")).toContain("over 1 MB");
    expect(missing.code).toBe(1);
    expect(missing.err.join("\n")).toContain("ENOENT");
    expect(callsOf(daemon, "file.write")).toEqual([]);
  });

  test("--file, --hash and --confirm belong to write: another file verb refuses them", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "file.read": () => ({ path: "a", text: "", hash: "h", size: 0 }),
    });
    const runs = await Promise.all([
      flightdeckd(["file", "read", "card:c1", "src/a.ts", "--confirm"], daemon.port),
      flightdeckd(["file", "read", "card:c1", "src/a.ts", "--hash", HASH_A], daemon.port),
      flightdeckd(["file", "list", "card:c1", "--file", "x"], daemon.port),
    ]);
    expect(runs.map((r) => r.code)).toEqual([1, 1, 1]);
    expect(runs.map((r) => r.err.join("\n"))).toEqual([
      expect.stringContaining("--confirm: this flag only applies to flightdeckd file write"),
      expect.stringContaining("--hash: this flag only applies to flightdeckd file write"),
      expect.stringContaining("--file: this flag only applies to flightdeckd file write"),
    ]);
  });
});
