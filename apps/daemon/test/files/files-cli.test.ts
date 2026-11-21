import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { resolve } from "node:path";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const LISTING = {
  dir: "src",
  entries: [
    { name: "components", kind: "dir" },
    { name: "a.ts", kind: "file" },
    { name: ".env", kind: "file", secret: true },
  ],
  truncated: false,
};

const FILE = { path: "src/a.ts", text: "const a = 1;\n\tlet b = 2;\n", hash: "9f86d0", size: 25 };

const SEARCH_CONTENT = {
  mode: "content",
  query: "TODO",
  matches: [
    { path: "src/a.ts", line: 3, text: "// TODO: split this" },
    { path: "src/b.ts", line: 10, text: "  TODO(fd): remove" },
  ],
  truncated: false,
};

const SEARCH_NAME = {
  mode: "name",
  query: "env",
  matches: [{ path: "src/env.ts" }, { path: ".env", secret: true }],
  truncated: true,
};

const DIRS = {
  path: "/work",
  parent: "/",
  dirs: [
    { name: "api", path: "/work/api" },
    { name: "web", path: "/work/web" },
  ],
  truncated: false,
};

const FILES = {
  path: "/work/api",
  files: [
    { name: "README.md", path: "/work/api/README.md" },
    { name: "package.json", path: "/work/api/package.json" },
  ],
  truncated: false,
};

const OPEN: Handlers = {
  "file.list": () => LISTING,
  "file.read": () => FILE,
  "file.search": () => SEARCH_CONTENT,
  "fs.dirs": () => DIRS,
  "fs.files": () => FILES,
};

const printed = (out: string[]) => {
  try {
    return JSON.parse(out.join("\n")) as unknown;
  } catch {
    return null;
  }
};

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

const refusing = (type: string, code: string, message: string): Handlers => ({
  ...OPEN,
  [type]: () => ({ error: { code, message } }),
});

describe("flightdeckd file list (issue #3624)", () => {
  test("a folder of the repository: folders and files, a credential file marked and never opened", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["file", "list", "card:c1", "--dir", "src"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "card:c1 src",
        "  dir  components/",
        "  file a.ts",
        "  file .env (may hold a credential, not read)",
      ],
      err: [],
    });
    expect(callsOf(daemon, "file.list")).toEqual([{ target: "card:c1", dir: "src" }]);
  });

  test("without --dir it lists the repository's root, and an empty folder says so", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "file.list": () => ({ dir: "", entries: [], truncated: false }),
    });
    const run = await flightdeckd(["file", "list", "session:s1"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({
      code: 0,
      out: ["session:s1 .", "empty folder"],
    });
    expect(callsOf(daemon, "file.list")).toEqual([{ target: "session:s1", dir: "" }]);
  });

  test("more entries than the daemon sends at once is said", async () => {
    const daemon = fakeDaemon({ ...OPEN, "file.list": () => ({ ...LISTING, truncated: true }) });
    const run = await flightdeckd(["file", "list", "card:c1", "--dir", "src"], daemon.port);
    expect(run.out.at(-1)).toBe("more entries than the daemon sends at once");
  });

  test("--json prints every key, secret false for an ordinary entry", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["file", "list", "card:c1", "--dir", "src", "--json"],
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual({
      dir: "src",
      entries: [
        { name: "components", kind: "dir", secret: false },
        { name: "a.ts", kind: "file", secret: false },
        { name: ".env", kind: "file", secret: true },
      ],
      truncated: false,
    });
  });

  test("a folder the daemon refuses is one line on stderr and exit 1; a closed connection is exit 2", async () => {
    const outside = fakeDaemon(
      refusing("file.list", "review_outside", "path is outside the repository"),
    );
    const gone = fakeDaemon({ ...OPEN, "file.list": () => CLOSE });
    const refused = await flightdeckd(["file", "list", "card:c1", "--dir", "../etc"], outside.port);
    expect({ code: refused.code, out: refused.out }).toEqual({ code: 1, out: [] });
    expect(refused.err.join("\n")).toContain("path is outside the repository");
    expect((await flightdeckd(["file", "list", "card:c1"], gone.port)).code).toBe(2);
  });

  test("a name from the daemon cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "file.list": () => ({
        dir: "s\u001b[2Jrc",
        entries: [{ name: "a\u001b[2J.ts", kind: "file" }],
        truncated: false,
      }),
    });
    const run = await flightdeckd(["file", "list", "card:c1"], daemon.port);
    expect(run.out).toEqual(["card:c1 s [2Jrc", "  file a [2J.ts"]);
  });
});

describe("flightdeckd file read (issue #3624)", () => {
  test("the file's hash and size, then its text one line at a time, control characters cleaned", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["file", "read", "card:c1", "src/a.ts"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["src/a.ts (25 bytes, hash 9f86d0)", "const a = 1;", " let b = 2;"],
      err: [],
    });
    expect(callsOf(daemon, "file.read")).toEqual([{ target: "card:c1", path: "src/a.ts" }]);
  });

  test("an escape sequence in the file never reaches the terminal", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "file.read": () => ({ ...FILE, text: "ok\n\u001b[2Jwiped\n" }),
    });
    const run = await flightdeckd(["file", "read", "card:c1", "src/a.ts"], daemon.port);
    expect(run.out.join("\n")).toContain("wiped");
    expect(run.out.join("\n").includes("\u001b")).toBe(false);
  });

  test("--json prints the path, the text as the daemon sent it, the hash and the size", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["file", "read", "card:c1", "src/a.ts", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual(FILE);
  });

  test.each([
    ["review_file_missing", "no such file"],
    ["review_file_big", "the file is over 1 MB"],
    ["review_file_binary", "the file is binary"],
    ["review_credential", "the file may hold a credential"],
  ])("%s is exit 1 with the daemon's text and no content", async (code, message) => {
    const daemon = fakeDaemon(refusing("file.read", code, message));
    const run = await flightdeckd(["file", "read", "card:c1", ".env"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain(message);
  });

  test("no daemon is exit 2", async () => {
    const gone = fakeDaemon({ ...OPEN, "file.read": () => CLOSE });
    expect((await flightdeckd(["file", "read", "card:c1", "src/a.ts"], gone.port)).code).toBe(2);
  });
});

describe("flightdeckd file search (issue #3624)", () => {
  test("a content search: one line a match with its path, line and text", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["file", "search", "card:c1", "--mode", "content", "--query", "TODO"],
      daemon.port,
    );
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        'content "TODO" in card:c1: 2 matches',
        "  src/a.ts:3: // TODO: split this",
        "  src/b.ts:10:   TODO(fd): remove",
      ],
      err: [],
    });
    expect(callsOf(daemon, "file.search")).toEqual([
      { target: "card:c1", mode: "content", query: "TODO" },
    ]);
  });

  test("--limit goes to the daemon as typed", async () => {
    const daemon = fakeDaemon(OPEN);
    await flightdeckd(
      ["file", "search", "card:c1", "--mode", "name", "--query", "env", "--limit", "5"],
      daemon.port,
    );
    expect(callsOf(daemon, "file.search")).toEqual([
      { target: "card:c1", mode: "name", query: "env", limit: 5 },
    ]);
  });

  test("a name search lists a credential file as one with no content, and says the list was cut", async () => {
    const daemon = fakeDaemon({ ...OPEN, "file.search": () => SEARCH_NAME });
    const run = await flightdeckd(
      ["file", "search", "card:c1", "--mode", "name", "--query", "env"],
      daemon.port,
    );
    expect(run.out).toEqual([
      'name "env" in card:c1: 2 matches',
      "  src/env.ts",
      "  .env (may hold a credential, content not searched)",
      "more matches than shown: narrow the query or raise --limit",
    ]);
  });

  test("no match is one line and exit 0", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "file.search": () => ({ mode: "name", query: "zzz", matches: [], truncated: false }),
    });
    const run = await flightdeckd(
      ["file", "search", "card:c1", "--mode", "name", "--query", "zzz"],
      daemon.port,
    );
    expect({ code: run.code, out: run.out }).toEqual({
      code: 0,
      out: ['name "zzz" in card:c1: no matches'],
    });
  });

  test("--json prints every key, null for the line and text a name match has none of", async () => {
    const daemon = fakeDaemon({ ...OPEN, "file.search": () => SEARCH_NAME });
    const run = await flightdeckd(
      ["file", "search", "card:c1", "--mode", "name", "--query", "env", "--json"],
      daemon.port,
    );
    expect(printed(run.out)).toEqual({
      mode: "name",
      query: "env",
      matches: [
        { path: "src/env.ts", secret: false, line: null, text: null },
        { path: ".env", secret: true, line: null, text: null },
      ],
      truncated: true,
    });
  });

  test("a match's text cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "file.search": () => ({
        ...SEARCH_CONTENT,
        matches: [{ path: "a.ts", line: 1, text: "x\u001b[2Jy" }],
      }),
    });
    const run = await flightdeckd(
      ["file", "search", "card:c1", "--mode", "content", "--query", "x"],
      daemon.port,
    );
    expect(run.out.join("\n")).toContain("a.ts:1: x");
    expect(run.out.join("\n").includes("\u001b")).toBe(false);
  });

  test("a query the daemon refuses is exit 1; a closed connection is exit 2", async () => {
    const refusedDaemon = fakeDaemon(refusing("file.search", "invalid_payload", "bad query"));
    const gone = fakeDaemon({ ...OPEN, "file.search": () => CLOSE });
    const argv = ["file", "search", "card:c1", "--mode", "name", "--query", "env"];
    const refused = await flightdeckd(argv, refusedDaemon.port);
    expect({ code: refused.code, out: refused.out }).toEqual({ code: 1, out: [] });
    expect((await flightdeckd(argv, gone.port)).code).toBe(2);
  });
});

describe("flightdeckd file dirs and files (issue #3624)", () => {
  test("without a path, dirs lists the roots the host allows", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "fs.dirs": () => ({
        path: null,
        parent: null,
        dirs: [{ name: "work", path: "/work" }],
        truncated: false,
      }),
    });
    const run = await flightdeckd(["file", "dirs"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({
      code: 0,
      out: ["allowed roots", "  /work"],
    });
    expect(callsOf(daemon, "fs.dirs")).toEqual([{}]);
  });

  test("dirs lists the folders of a folder with its parent, --hidden adds the hidden ones", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["file", "dirs", "/work", "--hidden"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({
      code: 0,
      out: ["/work", "parent: /", "  /work/api", "  /work/web"],
    });
    expect(callsOf(daemon, "fs.dirs")).toEqual([{ path: "/work", hidden: true }]);
  });

  test("files lists the files of a folder", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["file", "files", "/work/api"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({
      code: 0,
      out: ["/work/api", "  /work/api/README.md", "  /work/api/package.json"],
    });
    expect(callsOf(daemon, "fs.files")).toEqual([{ path: "/work/api" }]);
  });

  test("a path typed relative is sent as the absolute path of this machine's folder", async () => {
    const daemon = fakeDaemon(OPEN);
    await flightdeckd(["file", "files", "some/folder"], daemon.port);
    expect(callsOf(daemon, "fs.files")).toEqual([{ path: resolve("some/folder") }]);
  });

  test("--json prints every key", async () => {
    const daemon = fakeDaemon(OPEN);
    const dirs = await flightdeckd(["file", "dirs", "/work", "--json"], daemon.port);
    const files = await flightdeckd(["file", "files", "/work/api", "--json"], daemon.port);
    expect(printed(dirs.out)).toEqual(DIRS);
    expect(printed(files.out)).toEqual(FILES);
  });

  test("a more-than-shown list says so", async () => {
    const daemon = fakeDaemon({ ...OPEN, "fs.dirs": () => ({ ...DIRS, truncated: true }) });
    const run = await flightdeckd(["file", "dirs", "/work"], daemon.port);
    expect(run.out.at(-1)).toBe("more folders than the daemon sends at once");
  });

  test("a folder outside the roots is exit 1; a closed connection is exit 2", async () => {
    const outside = fakeDaemon(
      refusing("fs.dirs", "forbidden", "folder is outside the allowed roots"),
    );
    const gone = fakeDaemon({ ...OPEN, "fs.files": () => CLOSE });
    const refused = await flightdeckd(["file", "dirs", "/etc"], outside.port);
    expect({ code: refused.code, out: refused.out }).toEqual({ code: 1, out: [] });
    expect(refused.err.join("\n")).toContain("outside the allowed roots");
    expect((await flightdeckd(["file", "files", "/work"], gone.port)).code).toBe(2);
  });
});

describe("flightdeckd file: the words and flags (issue #3624)", () => {
  const argsOf = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };

  test("`file list|read|search <target>` with their flags, and `file dirs|files [<path>]`", () => {
    expect(argsOf(["file", "list", "card:c1", "--dir", "src", "--json"])).toMatchObject({
      command: "file",
      action: "list",
      fileTarget: "card:c1",
      fileDir: "src",
      json: true,
    });
    expect(argsOf(["file", "read", "session:s1", "src/a.ts"])).toMatchObject({
      action: "read",
      fileTarget: "session:s1",
      filePath: "src/a.ts",
    });
    expect(
      argsOf([
        "file",
        "search",
        "project:p1",
        "--mode",
        "content",
        "--query",
        "TODO",
        "--limit",
        "7",
      ]),
    ).toMatchObject({
      action: "search",
      fileTarget: "project:p1",
      fileMode: "content",
      fileQuery: "TODO",
      fileLimit: 7,
    });
    expect(argsOf(["file", "dirs"])).toMatchObject({ action: "dirs", command: "file" });
    expect(argsOf(["file", "dirs", "/work", "--hidden", "--host", "pi"])).toMatchObject({
      action: "dirs",
      filePath: "/work",
      fileHidden: true,
      host: "pi",
    });
    expect(argsOf(["file", "files", "/work"])).toMatchObject({
      action: "files",
      filePath: "/work",
    });
  });

  test("the flags the other commands read stay with them", () => {
    const parsed = argsOf(["file", "list", "card:c1", "--dir", "src"]) as Record<string, unknown>;
    expect(parsed.command).toBe("file");
    expect(parsed.pluginDir).toBeUndefined();
    const search = argsOf([
      "file",
      "search",
      "card:c1",
      "--mode",
      "name",
      "--query",
      "env",
      "--limit",
      "5",
    ]) as Record<string, unknown>;
    expect([search.command, search.query, search.limit]).toEqual(["file", undefined, undefined]);
    expect(argsOf(["plugins", "preview", "--dir", "/p"])).toMatchObject({ pluginDir: "/p" });
  });

  test("a missing operand, a target that is not one and an unknown verb are refused", () => {
    expect(JSON.stringify(argsOf(["file", "list"]))).toContain("missing the target");
    expect(JSON.stringify(argsOf(["file", "read", "card:c1"]))).toContain("missing the file");
    expect(JSON.stringify(argsOf(["file", "list", "main"]))).toContain("invalid target");
    expect(JSON.stringify(argsOf(["file", "files"]))).toContain("missing the folder");
    expect(JSON.stringify(argsOf(["file", "remove", "card:c1"]))).toContain("invalid file action");
  });

  test("a search needs --mode and --query, a query of 1 to 200 characters with no control character, and a --limit of 1 to 200", () => {
    const base = ["file", "search", "card:c1"];
    expect(JSON.stringify(argsOf([...base, "--query", "x"]))).toContain("needs --mode");
    expect(JSON.stringify(argsOf([...base, "--mode", "name"]))).toContain("needs --query");
    expect(JSON.stringify(argsOf([...base, "--mode", "words", "--query", "x"]))).toContain(
      "--mode: name or content",
    );
    expect(JSON.stringify(argsOf([...base, "--mode", "name", "--query", ""]))).toContain("--query");
    expect(
      JSON.stringify(argsOf([...base, "--mode", "name", "--query", "a".repeat(201)])),
    ).toContain("200");
    expect(JSON.stringify(argsOf([...base, "--mode", "name", "--query", "a\u0000b"]))).toContain(
      "control character",
    );
    expect(
      JSON.stringify(argsOf([...base, "--mode", "name", "--query", "x", "--limit", "201"])),
    ).toContain("at most 200");
  });

  test("each flag belongs to its verbs", () => {
    const refused = (argv: string[]) => JSON.stringify(argsOf(argv));
    expect(refused(["file", "read", "card:c1", "a.ts", "--dir", "src"])).toContain(
      "--dir: this flag only applies to flightdeckd file list",
    );
    expect(refused(["file", "list", "card:c1", "--limit", "5"])).toContain(
      "--limit: this flag only applies to flightdeckd file search",
    );
    expect(refused(["file", "list", "card:c1", "--query", "x"])).toContain(
      "--query: this flag only applies to flightdeckd file search",
    );
    expect(refused(["file", "list", "card:c1", "--hidden"])).toContain(
      "--hidden: this flag only applies to flightdeckd file dirs, files",
    );
    expect(refused(["card", "list", "--mode", "name"])).toContain(
      "--mode: this flag only applies to flightdeckd file search",
    );
    expect(refused(["card", "list", "--hidden"])).toContain(
      "--hidden: this flag only applies to flightdeckd file dirs, files",
    );
  });

  test("on another host a relative folder is refused: the host's folders are not this machine's", () => {
    expect(JSON.stringify(argsOf(["file", "dirs", "work", "--host", "pi"]))).toContain(
      "--host needs an absolute folder",
    );
    expect(argsOf(["file", "dirs", "/work", "--host", "pi"])).toMatchObject({ host: "pi" });
  });
});
